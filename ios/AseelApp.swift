import UIKit
import AVKit
import SafariServices

// Aseel TV iPhone Simulator: reads the public Supabase catalogue through RLS.
private enum Config {
    static let endpoint = "https://qyzmlwtvzzgooccqxglq.supabase.co/rest/v1/"
    static let publishableKey = "sb_publishable_Mcev7qFw9oLWgKO7GBT8Kg_nHvaQ3ES"
    static let navy = UIColor(red: 0.035, green: 0.085, blue: 0.15, alpha: 1)
    static let gold = UIColor(red: 0.92, green: 0.77, blue: 0.48, alpha: 1)
}
struct Item: Decodable {
    var id: String
    var title_ar: String?
    var description: String?
    var stream_url: String?
    var official_url: String?
    var playback_mode: String?
    var quality: String?
    var rights_holder: String?
    var license_reference: String?
    var number: Int?
    var release_year: Int?
    var name: String { title_ar ?? "بدون عنوان" }
}
private enum API {
    static func read(_ table: String, params: [URLQueryItem] = [], done: @escaping ([Item]?, String?) -> Void) {
        guard ["aseel_movies", "aseel_series", "aseel_channels", "aseel_seasons", "aseel_episodes"].contains(table),
              var parts = URLComponents(string: Config.endpoint + table) else {
            done(nil, "Invalid resource"); return
        }
        parts.queryItems = [URLQueryItem(name: "select", value: "*"), URLQueryItem(name: "limit", value: "80")] + params
        guard let url = parts.url else { done(nil, "Invalid URL"); return }
        var request = URLRequest(url: url)
        request.setValue(Config.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 20
        URLSession.shared.dataTask(with: request) { data, response, error in
            var result: [Item]?
            var message = error?.localizedDescription
            if message == nil && (response as? HTTPURLResponse)?.statusCode != 200 {
                message = "HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)"
            }
            if message == nil {
                do { result = try JSONDecoder().decode([Item].self, from: data ?? Data()) }
                catch { message = error.localizedDescription }
            }
            DispatchQueue.main.async { done(result, message) }
        }.resume()
    }
}
@main
final class AseelApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions opts: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        let nav = UINavigationController(rootViewController: CatalogueViewController())
        nav.navigationBar.tintColor = Config.gold
        nav.navigationBar.titleTextAttributes = [.foregroundColor: Config.gold]
        w.rootViewController = nav
        w.overrideUserInterfaceStyle = .dark
        w.makeKeyAndVisible()
        window = w
        return true
    }
}
private func watch(_ item: Item, in controller: UIViewController) {
    if item.playback_mode == "official_link" {
        guard let target = item.official_url, let url = URL(string: target), url.scheme == "https" else {
            inform("الرابط الرسمي غير متاح", in: controller); return
        }
        controller.present(SFSafariViewController(url: url), animated: true)
        return
    }
    guard let source = item.stream_url, let url = URL(string: source), url.scheme == "https" else {
        inform("لا يوجد فيديو HTTPS مصرح به", in: controller); return
    }
    let player = AVPlayerViewController()
    player.player = AVPlayer(url: url)
    controller.present(player, animated: true) { player.player?.play() }
}
private func inform(_ message: String, in controller: UIViewController) {
    let alert = UIAlertController(title: "أسيل TV", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "موافق", style: .default))
    controller.present(alert, animated: true)
}

final class CatalogueViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, UISearchResultsUpdating {
    private let tabs = UISegmentedControl(items: ["أفلام", "مسلسلات", "قنوات", "المفضلة"])
    private let table = UITableView()
    private let caption = UILabel()
    private let searchController = UISearchController(searchResultsController: nil)
    private let resources = ["aseel_movies", "aseel_series", "aseel_channels"]
    private var sections: [[Item]] = [[], [], []]
    private var visible: [Item] = []
    private var keyword = ""
    private var lastRefresh = Date.distantPast
    private var refreshing = false
    private var timer: Timer?
    private var starred: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: "favorites_aseel_ios") ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: "favorites_aseel_ios") }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "أسيل | Aseel TV"
        view.backgroundColor = Config.navy
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(update))
        tabs.selectedSegmentIndex = 0
        tabs.selectedSegmentTintColor = Config.gold
        tabs.addTarget(self, action: #selector(render), for: .valueChanged)
        tabs.translatesAutoresizingMaskIntoConstraints = false
        caption.textColor = .lightGray
        caption.font = .systemFont(ofSize: 12)
        caption.textAlignment = .center
        caption.text = "أفلام ومسلسلات مرخصة • تحديث تلقائي"
        caption.translatesAutoresizingMaskIntoConstraints = false
        table.translatesAutoresizingMaskIntoConstraints = false
        table.backgroundColor = Config.navy
        table.separatorColor = .darkGray
        table.dataSource = self
        table.delegate = self
        table.rowHeight = 95
        let pull = UIRefreshControl()
        pull.tintColor = Config.gold
        pull.addTarget(self, action: #selector(update), for: .valueChanged)
        table.refreshControl = pull
        view.addSubview(tabs); view.addSubview(caption); view.addSubview(table)
        NSLayoutConstraint.activate([
            tabs.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            tabs.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            tabs.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            caption.topAnchor.constraint(equalTo: tabs.bottomAnchor, constant: 12),
            caption.leadingAnchor.constraint(equalTo: tabs.leadingAnchor),
            caption.trailingAnchor.constraint(equalTo: tabs.trailingAnchor),
            table.topAnchor.constraint(equalTo: caption.bottomAnchor, constant: 8),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        searchController.obscuresBackgroundDuringPresentation = false
        searchController.searchBar.placeholder = "ابحث عن فيلم أو مسلسل أو قناة"
        searchController.searchResultsUpdater = self
        navigationItem.searchController = searchController
        definesPresentationContext = true
        NotificationCenter.default.addObserver(self, selector: #selector(updateIfDue), name: UIApplication.willEnterForegroundNotification, object: nil)
        timer = Timer.scheduledTimer(timeInterval: 300, target: self, selector: #selector(updateIfDue), userInfo: nil, repeats: true)
        update()
    }
    deinit { timer?.invalidate(); NotificationCenter.default.removeObserver(self) }
    @objc private func updateIfDue() { if Date().timeIntervalSince(lastRefresh) >= 300 { update() } }
    @objc private func update() {
        if refreshing { table.refreshControl?.endRefreshing(); return }
        refreshing = true
        caption.text = "جاري تحديث مكتبة أسيل..."
        let group = DispatchGroup()
        var values: [[Item]] = [[], [], []]
        var failures = 0
        for (index, resource) in resources.enumerated() {
            group.enter()
            API.read(resource, params: [URLQueryItem(name: "order", value: "created_at.desc")]) { results, error in
                if let results = results { values[index] = results } else { failures += 1 }
                group.leave()
            }
        }
        group.notify(queue: .main) {
            self.refreshing = false
            self.table.refreshControl?.endRefreshing()
            if failures < 3 {
                self.sections = values
                self.lastRefresh = Date()
                self.caption.text = failures == 0 ? "المكتبة محدثة • المصادر مرخصة" : "تعذر تحديث بعض الأقسام"
            } else { self.caption.text = "تعذر الاتصال بقاعدة البيانات. حاول مجدداً." }
            self.render()
        }
    }
    @objc private func render() {
        let selected = tabs.selectedSegmentIndex
        let all = sections.flatMap { $0 }
        let source = selected == 3 ? all.filter { starred.contains($0.id) } : sections[selected]
        visible = keyword.isEmpty ? source : source.filter {
            $0.name.localizedCaseInsensitiveContains(keyword) ||
            ($0.description ?? "").localizedCaseInsensitiveContains(keyword)
        }
        table.reloadData()
    }
    func updateSearchResults(for searchController: UISearchController) {
        keyword = searchController.searchBar.text ?? ""
        render()
    }
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { visible.count }
    func tableView(_ tableView: UITableView, cellForRowAt path: IndexPath) -> UITableViewCell {
        let item = visible[path.row]
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.backgroundColor = Config.navy
        cell.textLabel?.text = item.name
        cell.textLabel?.textColor = .white
        cell.textLabel?.numberOfLines = 2
        cell.detailTextLabel?.text = item.playback_mode == "official_link" ? "المصدر الرسمي • افتح البث" :
            "\(item.release_year.map(String.init) ?? "") • \(item.quality ?? "HD") • \(item.rights_holder ?? "مرخص")"
        cell.detailTextLabel?.textColor = .lightGray
        cell.detailTextLabel?.numberOfLines = 2
        let mark = UIButton(type: .system)
        mark.frame = CGRect(x: 0, y: 0, width: 48, height: 48)
        mark.setTitle(starred.contains(item.id) ? "★" : "☆", for: .normal)
        mark.tintColor = Config.gold
        mark.titleLabel?.font = .systemFont(ofSize: 28)
        mark.addAction(UIAction { [weak self] _ in
            guard let self = self else { return }
            var f = self.starred
            if f.contains(item.id) { f.remove(item.id) } else { f.insert(item.id) }
            self.starred = f
            self.render()
        }, for: .touchUpInside)
        cell.accessoryView = mark
        return cell
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        let item = visible[indexPath.row]
        tableView.deselectRow(at: indexPath, animated: true)
        if sections[1].contains(where: { $0.id == item.id }) {
            navigationController?.pushViewController(EpisodesViewController(show: item), animated: true)
        } else { watch(item, in: self) }
    }
}

final class EpisodesViewController: UITableViewController {
    private let show: Item
    private var episodes: [Item] = []
    init(show: Item) { self.show = show; super.init(style: .plain) }
    required init?(coder: NSCoder) { fatalError("Storyboard not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = show.name
        tableView.backgroundColor = Config.navy
        tableView.rowHeight = 76
        API.read("aseel_seasons", params: [
            URLQueryItem(name: "series_id", value: "eq." + show.id),
            URLQueryItem(name: "order", value: "number.asc")
        ]) { seasons, error in
            guard let seasons = seasons, !seasons.isEmpty else {
                inform("لا توجد مواسم متاحة", in: self); return
            }
            let group = DispatchGroup()
            var found: [(Int, Item)] = []
            for season in seasons {
                group.enter()
                API.read("aseel_episodes", params: [
                    URLQueryItem(name: "season_id", value: "eq." + season.id),
                    URLQueryItem(name: "order", value: "number.asc")
                ]) { items, _ in
                    if let items = items { found.append(contentsOf: items.map { (season.number ?? 0, $0) }) }
                    group.leave()
                }
            }
            group.notify(queue: .main) {
                self.episodes = found.sorted { a, b in
                    a.0 == b.0 ? (a.1.number ?? 0) < (b.1.number ?? 0) : a.0 < b.0
                }.map { $0.1 }
                self.tableView.reloadData()
                if self.episodes.isEmpty { inform("لا توجد حلقات منشورة", in: self) }
            }
        }
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { episodes.count }
    override func tableView(_ tableView: UITableView, cellForRowAt path: IndexPath) -> UITableViewCell {
        let item = episodes[path.row]
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.backgroundColor = Config.navy
        cell.textLabel?.textColor = .white
        cell.textLabel?.text = "الحلقة \(item.number ?? path.row + 1) • \(item.name)"
        cell.detailTextLabel?.text = item.description ?? "عرض الحلقة"
        cell.detailTextLabel?.textColor = .lightGray
        cell.accessoryType = .disclosureIndicator
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt path: IndexPath) {
        tableView.deselectRow(at: path, animated: true)
        watch(episodes[path.row], in: self)
    }
}
