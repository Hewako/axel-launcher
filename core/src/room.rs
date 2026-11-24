//! Комната: игра в мире друга в одной сети (Wi-Fi) по коду из 5 символов.
//!
//! Хозяин открывает мир в игре «для сети». Его Minecraft раз в ~1,5 с объявляет мир в локальной
//! сети (UDP multicast 224.0.2.60:4445, `[MOTD]…[/MOTD][AD]порт[/AD]`) — Axel' хозяина слушает
//! это объявление со своего компьютера и узнаёт порт игры. Гость вводит код: его Axel' ищет
//! хозяина широковещательным запросом (UDP 47815), открывает у себя проход до игры хозяина и сам
//! объявляет мир у себя — мир появляется в «Сетевой игре», даже если роутер режет multicast.
//! Позже сюда же встанет связь через интернет: проход будет вести не напрямую, а через посредника.

use crate::error::{Error, Result};
use rand::Rng;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream, UdpSocket};

/// Порт, на котором Axel' хозяина отвечает на поиск комнаты.
pub const DISCOVERY_PORT: u16 = 47815;
const LAN_GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 2, 60);
const LAN_PORT: u16 = 4445;
/// Без 0/O и 1/I, чтобы код не путали при диктовке.
const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
pub const CODE_LEN: usize = 5;
const PROTO: &str = "AXEL-ROOM 1";

/// Случайный код комнаты, например `K7M2Q`.
pub fn new_code() -> String {
    let mut rng = rand::thread_rng();
    (0..CODE_LEN)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

/// Код, введённый человеком: без пробелов, в любом регистре. `None` — такого кода быть не может.
pub fn normalize_code(input: &str) -> Option<String> {
    let code: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_ascii_uppercase();
    (code.len() == CODE_LEN && code.bytes().all(|b| ALPHABET.contains(&b))).then_some(code)
}

/// Объявление мира в формате Minecraft.
pub fn lan_announcement(motd: &str, port: u16) -> String {
    // В названии мира не должно быть служебных скобок, иначе игра разберёт его неверно.
    let motd = motd.replace("[/MOTD]", "").replace("[AD]", "");
    format!("[MOTD]{motd}[/MOTD][AD]{port}[/AD]")
}

/// Разбор объявления Minecraft: название мира и порт.
pub fn parse_lan_announcement(data: &[u8]) -> Option<(String, u16)> {
    let text = std::str::from_utf8(data).ok()?;
    let motd = text.split_once("[MOTD]")?.1.split_once("[/MOTD]")?.0;
    let port = text.split_once("[AD]")?.1.split_once("[/AD]")?.0;
    let port: u16 = port.trim().parse().ok()?;
    (port > 0).then(|| (motd.to_string(), port))
}

fn query(code: &str) -> String {
    format!("{PROTO} ? {code}")
}

fn parse_query(data: &[u8]) -> Option<String> {
    let code = std::str::from_utf8(data)
        .ok()?
        .strip_prefix(PROTO)?
        .strip_prefix(" ? ")?;
    normalize_code(code)
}

/// Ответ хозяина: порт игры и название мира; порт 0 — комната есть, но мир ещё не открыт.
fn reply(code: &str, world: Option<&(String, u16)>) -> String {
    match world {
        Some((motd, port)) => format!("{PROTO} ! {code} {port} {motd}"),
        None => format!("{PROTO} ! {code} 0 "),
    }
}

/// Что ответил хозяин на наш код.
#[derive(Debug, Clone, PartialEq)]
enum Answer {
    Open(u16, String),
    Closed,
}

/// Ответ хозяина — если это ответ на наш код.
fn parse_reply(data: &[u8], code: &str) -> Option<Answer> {
    let rest = std::str::from_utf8(data)
        .ok()?
        .strip_prefix(PROTO)?
        .strip_prefix(" ! ")?;
    let rest = rest.strip_prefix(code)?.strip_prefix(' ')?;
    let (port, motd) = rest.split_once(' ').unwrap_or((rest, ""));
    match port.parse::<u16>().ok()? {
        0 => Some(Answer::Closed),
        p => Some(Answer::Open(p, motd.to_string())),
    }
}

/// Что происходит в комнате — для интерфейса.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RoomEvent {
    /// Хозяин: комната создана, ждём, пока мир откроют для сети.
    Waiting,
    /// Хозяин: мир открыт, комната отвечает гостям.
    WorldOpen { motd: String, port: u16 },
    /// Хозяин: гость нашёл комнату.
    GuestFound { ip: String },
    /// Гость: ищем хозяина.
    Searching,
    /// Гость: мир хозяина появился в «Сетевой игре»; `port` — проход на этом компьютере.
    Joined {
        motd: String,
        host: String,
        port: u16,
    },
}

pub type EventFn = Arc<dyn Fn(RoomEvent) + Send + Sync>;

fn net_err(what: &str, e: std::io::Error) -> Error {
    Error::Network {
        host: "локальная сеть".into(),
        reason: format!("{what}: {e}"),
    }
}

/// Сетевой адаптер компьютера: свой адрес и адрес широковещательной рассылки подсети.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Iface {
    ip: Ipv4Addr,
    broadcast: Ipv4Addr,
}

/// Все адаптеры с адресом IPv4 (кроме петли и «link-local» 169.254.x.x). Адаптеров может быть
/// несколько: Wi-Fi, кабель, VPN, виртуальные сети Hyper-V и WSL — игра шлёт объявления
/// через любой из них, поэтому один «основной» адрес не годится.
fn interfaces() -> Vec<Iface> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.addr {
            if_addrs::IfAddr::V4(v4) if !v4.ip.is_loopback() && !v4.ip.is_link_local() => {
                let mask = u32::from(v4.netmask);
                Some(Iface {
                    ip: v4.ip,
                    broadcast: v4
                        .broadcast
                        .unwrap_or_else(|| Ipv4Addr::from(u32::from(v4.ip) | !mask)),
                })
            }
            _ => None,
        })
        .collect()
}

/// Адрес принадлежит этому компьютеру.
fn is_this_machine(ip: IpAddr) -> bool {
    ip.is_loopback() || interfaces().iter().any(|i| IpAddr::V4(i.ip) == ip)
}

/// Подключение пришло с этого же компьютера: адрес собеседника совпадает с нашим адресом на
/// этом соединении (игра гостя стучится на свой адрес в сети) или это петля.
fn same_machine(peer: IpAddr, local: IpAddr) -> bool {
    peer.is_loopback() || peer == local
}

/// Ошибка, после которой сокет можно читать дальше. На Windows UDP-сокет получает такую ошибку,
/// когда наш ответ ушёл на уже закрытый порт (гость закрыл сокет после ответа).
fn is_transient(e: &std::io::Error) -> bool {
    use std::io::ErrorKind::*;
    matches!(
        e.kind(),
        ConnectionReset | ConnectionAborted | Interrupted | WouldBlock
    )
}

/// UDP-сокет с SO_REUSEADDR: порт 4445 у хозяина может быть занят его же Minecraft.
fn reusable_udp(port: u16) -> std::io::Result<UdpSocket> {
    use socket2::{Domain, Protocol, Socket, Type};
    let s = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    s.set_reuse_address(true)?;
    #[cfg(unix)]
    s.set_reuse_port(true)?;
    s.set_broadcast(true)?;
    s.bind(&SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)).into())?;
    s.set_nonblocking(true)?;
    UdpSocket::from_std(s.into())
}

/// Хозяин комнаты: следит, когда мир откроют для сети, и отвечает гостям с этим кодом.
/// Работает, пока задачу не отменят.
pub async fn host(code: String, on_event: EventFn) -> Result<()> {
    let lan = reusable_udp(LAN_PORT).map_err(|e| net_err("порт объявлений Minecraft", e))?;
    // Группу объявлений слушаем на каждом адаптере: игра шлёт их через тот, что выбрала система.
    let mut joined = 0;
    for i in interfaces() {
        joined += lan.join_multicast_v4(LAN_GROUP, i.ip).is_ok() as usize;
    }
    if joined == 0 {
        lan.join_multicast_v4(LAN_GROUP, Ipv4Addr::UNSPECIFIED)
            .map_err(|e| net_err("группа объявлений Minecraft", e))?;
    }
    let disc = reusable_udp(DISCOVERY_PORT).map_err(|e| net_err("порт комнаты", e))?;
    on_event(RoomEvent::Waiting);
    let mut world: Option<(String, u16)> = None;
    let (mut b1, mut b2) = ([0u8; 1024], [0u8; 256]);
    loop {
        tokio::select! {
            r = lan.recv_from(&mut b1) => {
                let (n, from) = match r {
                    Ok(v) => v,
                    Err(e) if is_transient(&e) => continue,
                    Err(e) => return Err(net_err("объявление Minecraft", e)),
                };
                // Берём только свой мир: объявления других компьютеров сети не наши.
                if let Some(w) = parse_lan_announcement(&b1[..n]).filter(|_| is_this_machine(from.ip()))
                    && world.as_ref() != Some(&w)
                {
                    on_event(RoomEvent::WorldOpen { motd: w.0.clone(), port: w.1 });
                    world = Some(w);
                }
            }
            r = disc.recv_from(&mut b2) => {
                let (n, from) = match r {
                    Ok(v) => v,
                    Err(e) if is_transient(&e) => continue,
                    Err(e) => return Err(net_err("поиск комнаты", e)),
                };
                if parse_query(&b2[..n]).as_deref() == Some(code.as_str()) {
                    // Отвечаем всегда: «мир ещё не открыт» гостю полезнее, чем тишина.
                    let _ = disc.send_to(reply(&code, world.as_ref()).as_bytes(), from).await;
                    if world.is_some() {
                        on_event(RoomEvent::GuestFound { ip: from.ip().to_string() });
                    }
                }
            }
        }
    }
}

/// Найденная комната.
#[derive(Debug, Clone)]
pub struct Found {
    /// Адрес игры хозяина.
    pub addr: SocketAddr,
    pub motd: String,
    /// Адаптер этого компьютера, через который пришёл ответ; `None` — хозяин на этом же компьютере.
    pub via: Option<Ipv4Addr>,
}

/// Найти хозяина комнаты в сети. Ждём до `wait`: комната может быть создана, а мир открыт позже.
pub async fn find(code: &str, wait: Duration) -> Result<Found> {
    use tokio::sync::mpsc;
    use tokio::task::JoinSet;
    let q = query(code);
    let mut tasks = JoinSet::new();
    let (tx, mut rx) = mpsc::unbounded_channel::<(Answer, SocketAddr, Option<Ipv4Addr>)>();
    // Один сокет на каждый адаптер, чтобы запрос ушёл во все сети, плюс общий — для петли.
    let mut senders: Vec<(Option<Ipv4Addr>, Vec<Ipv4Addr>, Arc<UdpSocket>)> = Vec::new();
    let mut plan: Vec<(Option<Ipv4Addr>, Vec<Ipv4Addr>)> = interfaces()
        .into_iter()
        .map(|i| (Some(i.ip), vec![i.broadcast, Ipv4Addr::BROADCAST]))
        .collect();
    plan.push((None, vec![Ipv4Addr::BROADCAST, Ipv4Addr::LOCALHOST]));
    for (via, targets) in plan {
        let bind = via.unwrap_or(Ipv4Addr::UNSPECIFIED);
        let Ok(s) = UdpSocket::bind((bind, 0)).await else {
            continue;
        };
        let _ = s.set_broadcast(true);
        let s = Arc::new(s);
        senders.push((via, targets, s.clone()));
        let (tx, code) = (tx.clone(), code.to_string());
        tasks.spawn(async move {
            let mut buf = [0u8; 512];
            loop {
                match s.recv_from(&mut buf).await {
                    Ok((n, from)) => {
                        if let Some(a) = parse_reply(&buf[..n], &code) {
                            let _ = tx.send((a, from, via));
                        }
                    }
                    Err(e) if is_transient(&e) => {}
                    Err(_) => return,
                }
            }
        });
    }
    if senders.is_empty() {
        return Err(net_err(
            "поиск комнаты",
            std::io::Error::other("нет сетевого подключения"),
        ));
    }
    let deadline = tokio::time::Instant::now() + wait;
    let mut closed = false;
    while tokio::time::Instant::now() < deadline {
        for (_, targets, s) in &senders {
            for t in targets {
                let _ = s.send_to(q.as_bytes(), (*t, DISCOVERY_PORT)).await;
            }
        }
        let until = (tokio::time::Instant::now() + Duration::from_secs(1)).min(deadline);
        while let Ok(Some((answer, from, via))) = tokio::time::timeout_at(until, rx.recv()).await {
            match answer {
                Answer::Open(port, motd) => {
                    return Ok(Found {
                        addr: SocketAddr::new(from.ip(), port),
                        motd,
                        via: via.filter(|_| !from.ip().is_loopback()),
                    });
                }
                Answer::Closed => closed = true,
            }
        }
    }
    Err(Error::invalid(if closed {
        format!(
            "Комната {code} есть, но хозяин ещё не открыл мир для сети. Пусть в игре нажмёт Esc и «Открыть для сети»."
        )
    } else {
        format!(
            "Комната {code} не отвечает. Проверьте код и что вы в одной сети Wi-Fi. Если хозяин на Windows, Axel' должен быть разрешён в брандмауэре для частных сетей."
        )
    }))
}

/// UDP-сокет для объявлений мира: наружу через адаптер `via` (если известен).
fn announcer(via: Option<Ipv4Addr>) -> std::io::Result<UdpSocket> {
    use socket2::{Domain, Protocol, Socket, Type};
    let s = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    if let Some(ip) = via {
        s.set_multicast_if_v4(&ip)?;
    }
    s.set_multicast_loop_v4(true)?;
    s.bind(&SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0)).into())?;
    s.set_nonblocking(true)?;
    UdpSocket::from_std(s.into())
}

/// Гость: найти комнату, открыть у себя проход до игры хозяина и объявить мир в «Сетевой игре».
/// Работает, пока задачу не отменят.
pub async fn join(code: String, on_event: EventFn) -> Result<()> {
    on_event(RoomEvent::Searching);
    let found = find(&code, Duration::from_secs(15)).await?;
    let host_addr = found.addr;
    // Проход: игра гостя подключается к нему, он пересылает всё хозяину.
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
        .await
        .map_err(|e| net_err("проход до игры хозяина", e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| net_err("проход", e))?
        .port();
    let shown = format!("{} · {code}", found.motd);
    on_event(RoomEvent::Joined {
        motd: shown.clone(),
        host: host_addr.ip().to_string(),
        port: local_port,
    });
    // Объявляем мир через тот адаптер, где нашли хозяина: так в списке игры один адрес, а не по
    // одному на каждый адаптер.
    let announcer = announcer(found.via)
        .or_else(|_| announcer(None))
        .map_err(|e| net_err("объявление мира", e))?;
    let ad = lan_announcement(&shown, local_port);
    let mut tick = tokio::time::interval(Duration::from_millis(1500));
    loop {
        tokio::select! {
            _ = tick.tick() => {
                let _ = announcer.send_to(ad.as_bytes(), (LAN_GROUP, LAN_PORT)).await;
            }
            r = listener.accept() => {
                let Ok((mut game, from)) = r else { continue };
                // Проход только для игры на этом компьютере. Игра идёт по адресу из списка, то есть
                // на один из адресов этого компьютера, поэтому сверяем с адресом на самом соединении.
                let local = game.local_addr().map(|a| a.ip()).ok();
                if !local.is_some_and(|l| same_machine(from.ip(), l)) {
                    continue;
                }
                tokio::spawn(async move {
                    if let Ok(mut up) = TcpStream::connect(host_addr).await {
                        let _ = game.set_nodelay(true);
                        let _ = up.set_nodelay(true);
                        let _ = tokio::io::copy_bidirectional(&mut game, &mut up).await;
                    }
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_random_and_readable() {
        let a = new_code();
        assert_eq!(a.len(), CODE_LEN);
        assert!(a.bytes().all(|b| ALPHABET.contains(&b)));
        assert!(!a.contains(['0', 'O', '1', 'I']));
        let many: std::collections::HashSet<String> = (0..200).map(|_| new_code()).collect();
        assert!(many.len() > 190, "коды не повторяются подряд");
    }

    #[test]
    fn typed_codes_are_normalized() {
        assert_eq!(normalize_code(" k7m2q ").as_deref(), Some("K7M2Q"));
        assert_eq!(normalize_code("K7M-2Q").as_deref(), Some("K7M2Q"));
        assert_eq!(normalize_code("K7M2"), None);
        assert_eq!(normalize_code("K7M2O"), None, "буквы O в кодах нет");
    }

    #[test]
    fn minecraft_announcements() {
        let ad = lan_announcement("Мир Васи", 51234);
        assert_eq!(ad, "[MOTD]Мир Васи[/MOTD][AD]51234[/AD]");
        assert_eq!(
            parse_lan_announcement(ad.as_bytes()),
            Some(("Мир Васи".into(), 51234))
        );
        assert_eq!(parse_lan_announcement(b"[MOTD]x[/MOTD][AD]0[/AD]"), None);
        assert_eq!(parse_lan_announcement(b"garbage"), None);
    }

    #[test]
    fn room_protocol_round_trip() {
        assert_eq!(
            parse_query(query("K7M2Q").as_bytes()).as_deref(),
            Some("K7M2Q")
        );
        assert_eq!(parse_query(b"AXEL-ROOM 1 ? nope"), None);
        let r = reply("K7M2Q", Some(&("Мир Васи".to_string(), 51234)));
        assert_eq!(
            parse_reply(r.as_bytes(), "K7M2Q"),
            Some(Answer::Open(51234, "Мир Васи".into()))
        );
        assert_eq!(
            parse_reply(reply("K7M2Q", None).as_bytes(), "K7M2Q"),
            Some(Answer::Closed),
            "мир не открыт — это ответ, а не тишина"
        );
        assert_eq!(parse_reply(r.as_bytes(), "AAAAA"), None, "чужой код");
    }

    #[test]
    fn same_machine_connections() {
        let lan: IpAddr = "192.168.1.5".parse().unwrap();
        let other: IpAddr = "192.168.1.9".parse().unwrap();
        assert!(same_machine("127.0.0.1".parse().unwrap(), lan));
        assert!(same_machine(lan, lan), "игра идёт на свой адрес в сети");
        assert!(
            !same_machine(other, lan),
            "чужой компьютер в проход не пускаем"
        );
    }

    #[test]
    fn loopback_is_this_machine() {
        assert!(is_this_machine("127.0.0.1".parse().unwrap()));
        assert!(!is_this_machine("203.0.113.7".parse().unwrap()));
    }

    #[test]
    fn dropped_replies_do_not_kill_the_room() {
        let reset = std::io::Error::from(std::io::ErrorKind::ConnectionReset);
        assert!(is_transient(&reset));
        assert!(!is_transient(&std::io::Error::from(
            std::io::ErrorKind::PermissionDenied
        )));
    }

    /// Поиск и ответ по-настоящему, через петлю 127.0.0.1 (широковещательные пакеты в тестах
    /// на macOS режет защита «Локальная сеть»). Проверяет и проход гостя до «игры» хозяина.
    #[tokio::test]
    #[ignore = "сеть компьютера: проверено вручную, `cargo test -p quarry-core room -- --ignored`"]
    async fn host_answers_search_and_guest_proxies() {
        let code = new_code();
        let h = tokio::spawn(host(code.clone(), Arc::new(|_| {})));
        tokio::time::sleep(Duration::from_millis(300)).await;
        // «Игра» хозяина: TCP-сервер, который отвечает эхом.
        // Как настоящий Minecraft — на всех адресах: гость стучится по адресу хозяина в сети.
        let game = TcpListener::bind("0.0.0.0:0").await.unwrap();
        let game_port = game.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut c, _) = game.accept().await.unwrap();
            let (mut r, mut w) = c.split();
            let _ = tokio::io::copy(&mut r, &mut w).await;
        });
        // Притворяемся Minecraft хозяина: объявляем мир на этот же компьютер.
        let mc = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        for _ in 0..3 {
            mc.send_to(
                lan_announcement("Тест", game_port).as_bytes(),
                ("127.0.0.1", LAN_PORT),
            )
            .await
            .unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let f = find(&code, Duration::from_secs(5)).await.unwrap();
        assert_eq!((f.addr.port(), f.motd.as_str()), (game_port, "Тест"));

        // Гость: проход до игры хозяина передаёт данные в обе стороны.
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let ev = events.clone();
        let g = tokio::spawn(join(
            code.clone(),
            Arc::new(move |e| ev.lock().unwrap().push(e)),
        ));
        let mut port = None;
        for _ in 0..50 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            port = events.lock().unwrap().iter().find_map(|e| match e {
                RoomEvent::Joined { port, .. } => Some(*port),
                _ => None,
            });
            if port.is_some() {
                break;
            }
        }
        let mut c = TcpStream::connect(("127.0.0.1", port.expect("гость вошёл")))
            .await
            .unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        c.write_all(b"ping").await.unwrap();
        let mut buf = [0u8; 4];
        c.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"ping");
        h.abort();
        g.abort();
    }

    /// Комната создана, а мир ещё не открыт: гость узнаёт об этом, а не получает тишину.
    #[tokio::test]
    #[ignore = "сеть компьютера: `cargo test -p quarry-core room -- --ignored`"]
    async fn closed_room_is_reported() {
        let code = new_code();
        let h = tokio::spawn(host(code.clone(), Arc::new(|_| {})));
        tokio::time::sleep(Duration::from_millis(300)).await;
        let e = find(&code, Duration::from_secs(3)).await.unwrap_err();
        assert!(e.to_string().contains("не открыл мир"), "{e}");
        h.abort();
    }
}
