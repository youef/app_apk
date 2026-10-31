import UIKit
import AVKit
import SafariServices

// Al Ezz TV iPhone Simulator: reads the approved public Supabase catalogue via RLS.
private enum Config {
    static let endpoint = "https://qyzmlwtvzzgooccqxglq.supabase.co/rest/v1/"
    static let publishableKey = "sb_publishable_Mcev7qFw9oLWgKO7GBT8Kg_nHvaQ3ES"
    static let navy = UIColor(red: 0.045, green: 0.047, blue: 0.064, alpha: 1)
    static let gold = UIColor(red: 0.99, green: 0.24, blue: 0.32, alpha: 1)
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
    var poster_url: String?
    var is_kids: Bool?
    var country_code: String?
    var language_code: String?
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
    guard let source = item.stream_url, let url = URL(string: source), url.scheme == "https",
          [".mp4", ".m3u8"].contains(where: { url.path.lowercased().hasSuffix($0) }) else {
        inform("لا يوجد فيديو HTTPS مصرح به", in: controller); return
    }
    let player = AVPlayerViewController()
    player.player = AVPlayer(url: url)
    controller.present(player, animated: true) { player.player?.play() }
}
private func inform(_ message: String, in controller: UIViewController) {
    let alert = UIAlertController(title: "العز TV", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "موافق", style: .default))
    controller.present(alert, animated: true)
}

final class CatalogueViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, UISearchResultsUpdating {
    private let tabs = UISegmentedControl(items: ["أفلام", "مسلسلات", "قنوات", "الأطفال", "المفضلة"])
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
        title = "العز | Al Ezz TV"
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
        table.rowHeight = 112
        table.separatorStyle = .none
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
        caption.text = "جاري تحديث مكتبة العز..."
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
        let source: [Item]
        if selected == 4 { source = all.filter { starred.contains($0.id) } }
        else if selected == 3 { source = all.filter { $0.is_kids == true } }
        else { source = sections[min(max(selected,0),2)] }
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
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.backgroundColor = Config.navy
        cell.selectionStyle = .none
        let panel = UIView()
        panel.backgroundColor = UIColor(red: 0.095, green: 0.105, blue: 0.135, alpha: 1)
        panel.layer.cornerRadius = 12
        panel.layer.borderWidth = 1
        panel.layer.borderColor = UIColor(white: 1, alpha: 0.08).cgColor
        panel.translatesAutoresizingMaskIntoConstraints = false
        cell.contentView.addSubview(panel)
        let art = UIImageView()
        art.backgroundColor = UIColor(red: 0.18, green: 0.14, blue: 0.19, alpha: 1)
        art.layer.cornerRadius = 9
        art.clipsToBounds = true
        art.contentMode = .scaleAspectFill
        art.translatesAutoresizingMaskIntoConstraints = false
        panel.addSubview(art)
        let t = UILabel()
        t.text = item.name
        t.textColor = .white
        t.font = .boldSystemFont(ofSize: 16)
        t.numberOfLines = 2
        t.textAlignment = .right
        t.translatesAutoresizingMaskIntoConstraints = false
        panel.addSubview(t)
        let meta = UILabel()
        meta.text = (item.is_kids == true ? "★ أطفال  •  " : "") +
            (item.release_year.map(String.init) ?? "") + "  •  " + (item.quality ?? "مباشر")
        meta.textColor = UIColor(white: 0.72, alpha: 1)
        meta.font = .systemFont(ofSize: 11)
        meta.textAlignment = .right
        meta.translatesAutoresizingMaskIntoConstraints = false
        panel.addSubview(meta)
        NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: cell.contentView.leadingAnchor, constant: 12),
            panel.trailingAnchor.constraint(equalTo: cell.contentView.trailingAnchor, constant: -12),
            panel.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 5),
            panel.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -5),
            art.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -10),
            art.centerYAnchor.constraint(equalTo: panel.centerYAnchor),
            art.widthAnchor.constraint(equalToConstant: 124),
            art.heightAnchor.constraint(equalToConstant: 80),
            t.trailingAnchor.constraint(equalTo: art.leadingAnchor, constant: -13),
            t.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 14),
            t.topAnchor.constraint(equalTo: panel.topAnchor, constant: 20),
            meta.trailingAnchor.constraint(equalTo: t.trailingAnchor),
            meta.leadingAnchor.constraint(equalTo: t.leadingAnchor),
            meta.topAnchor.constraint(equalTo: t.bottomAnchor, constant: 9)
        ])
        if let urlString = item.poster_url, let url = URL(string: urlString), url.scheme == "https" {
            URLSession.shared.dataTask(with: url) { data, _, _ in
                guard let bytes = data, bytes.count < 2_000_000, let image = UIImage(data: bytes) else { return }
                DispatchQueue.main.async { art.image = image }
            }.resume()
        }
        let mark = UIButton(type: .system)
        mark.frame = CGRect(x: 0, y: 0, width: 38, height: 45)
        mark.setTitle(starred.contains(item.id) ? "★" : "☆", for: .normal)
        mark.tintColor = Config.gold
        mark.titleLabel?.font = .systemFont(ofSize: 22)
        mark.addAction(UIAction { [weak self] _ in
            guard let self = self else { return }
            var favorites = self.starred
            if favorites.contains(item.id) { favorites.remove(item.id) }
            else { favorites.insert(item.id) }
            self.starred = favorites
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
        } else {
            navigationController?.pushViewController(ContentDetailViewController(item: item), animated: true)
        }
    }
}

final class ContentDetailViewController: UIViewController {
    private let item: Item
    init(item: Item) { self.item = item; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("Storyboard not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = item.name
        view.backgroundColor = Config.navy
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 18
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -22),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20)
        ])
        func label(_ value: String, size: CGFloat, color: UIColor) {
            let text = UILabel()
            text.text = value
            text.textColor = color
            text.numberOfLines = 0
            text.textAlignment = .natural
            text.font = .systemFont(ofSize: size)
            stack.addArrangedSubview(text)
        }
        label(item.name, size: 27, color: .white)
        label(item.description ?? "عمل مرخّص ومتوفّر للمشاهدة", size: 17, color: .white)
        label("حقوق العمل: " + (item.rights_holder ?? "مصدر مرخص"), size: 14, color: .lightGray)
        let play = UIButton(type: .system)
        play.configuration = .filled()
        play.configuration?.baseBackgroundColor = Config.gold
        play.configuration?.baseForegroundColor = .white
        play.configuration?.title = "▶ تشغيل الفيديو"
        play.addTarget(self, action: #selector(startPlayback), for: .touchUpInside)
        stack.addArrangedSubview(play)
        if let reference = item.license_reference, !reference.isEmpty {
            let license = UIButton(type: .system)
            license.setTitle("عرض المصدر ووثيقة الحقوق", for: .normal)
            license.tintColor = Config.gold
            license.addTarget(self, action: #selector(openLicense), for: .touchUpInside)
            stack.addArrangedSubview(license)
        }
        label("تحافظ منصة العز على حقوق أصحاب الأعمال. تُعرض بعض القنوات من موقع المصدر الرسمي.", size: 12, color: .lightGray)
    }
    @objc private func startPlayback() { watch(item, in: self) }
    @objc private func openLicense() {
        guard let raw = item.license_reference?.components(separatedBy: ";").first?.trimmingCharacters(in: .whitespacesAndNewlines),
              let url = URL(string: raw), url.scheme == "https" else {
            inform("المرجع ليس رابط HTTPS قابلًا للفتح", in: self)
            return
        }
        present(SFSafariViewController(url: url), animated: true)
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
        navigationController?.pushViewController(ContentDetailViewController(item: episodes[path.row]), animated: true)
    }
}
