import UIKit
import WebKit
import SafariServices

// Al Ezz TV • iPhone/iPad Red Glass Cinema V4.
// Native iOS container for the same authenticated web experience used by the
// Android and browser clients. No privileged Supabase credentials are embedded.
// Physical iPhone installation requires Apple Developer signing and provisioning.
private enum EzzIOS {
    static let home = URL(string: "https://app-apk-oquy.onrender.com/web/")!
    static let background = UIColor(red: 9 / 255, green: 9 / 255, blue: 15 / 255, alpha: 1)
    static let crimson = UIColor(red: 227 / 255, green: 50 / 255, blue: 70 / 255, alpha: 1)
    static let pale = UIColor(red: 1, green: 0.80, blue: 0.85, alpha: 1)
}

// Simple UIKit launch avoids any third-party framework, tracking SDK or
// animation that could interrupt playback on older iPhone models.
@main
final class AlEzzIOSApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.backgroundColor = EzzIOS.background
        window.overrideUserInterfaceStyle = .dark
        window.rootViewController = CinemaContainerController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

final class CinemaContainerController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var browser: WKWebView!
    private let loading = UIActivityIndicatorView(style: .large)
    private let errorPanel = UIView()
    private let errorLabel = UILabel()
    private let reloadButton = UIButton(type: .system)
    private let splash = UIView()
    private let refresh = UIRefreshControl()
    private var isSplashVisible = false

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .allButUpsideDown }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = EzzIOS.background
        configureWebKit()
        configureFailureUI()
        configureSplash()
        openHome()
    }

    private func configureWebKit() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default() // Preserve login session across launches.
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all // No surprise autoplay.
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.applicationNameForUserAgent = "AlEzzTV-iOS/4"

        browser = WKWebView(frame: .zero, configuration: configuration)
        browser.navigationDelegate = self
        browser.uiDelegate = self
        browser.isOpaque = false
        browser.backgroundColor = EzzIOS.background
        browser.scrollView.backgroundColor = EzzIOS.background
        browser.scrollView.contentInsetAdjustmentBehavior = .never
        browser.scrollView.bounces = true
        browser.allowsBackForwardNavigationGestures = true
        browser.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(browser)
        NSLayoutConstraint.activate([
            browser.topAnchor.constraint(equalTo: view.topAnchor),
            browser.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            browser.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            browser.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        refresh.tintColor = EzzIOS.crimson
        refresh.addTarget(self, action: #selector(reloadPage), for: .valueChanged)
        browser.scrollView.refreshControl = refresh
    }

    private func configureFailureUI() {
        errorPanel.isHidden = true
        errorPanel.backgroundColor = EzzIOS.background
        errorPanel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(errorPanel)

        let emblem = UIImageView(image: UIImage(systemName: "wifi.exclamationmark"))
        emblem.tintColor = EzzIOS.crimson
        emblem.contentMode = .scaleAspectFit
        emblem.translatesAutoresizingMaskIntoConstraints = false

        let title = UILabel()
        title.text = "تعذر الاتصال بالعز TV"
        title.textColor = .white
        title.font = .boldSystemFont(ofSize: 26)
        title.textAlignment = .center
        title.adjustsFontSizeToFitWidth = true

        errorLabel.text = "تحقق من الإنترنت ثم حاول مجددًا."
        errorLabel.textColor = EzzIOS.pale
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.font = .systemFont(ofSize: 15)

        if #available(iOS 15.0, *) {
            var config = UIButton.Configuration.filled()
            config.title = "إعادة المحاولة"
            config.image = UIImage(systemName: "arrow.clockwise")
            config.imagePadding = 9
            config.imagePlacement = .trailing
            config.baseBackgroundColor = EzzIOS.crimson
            config.baseForegroundColor = .white
            config.cornerStyle = .large
            reloadButton.configuration = config
        } else {
            reloadButton.setTitle("إعادة المحاولة", for: .normal)
            reloadButton.backgroundColor = EzzIOS.crimson
        }
        reloadButton.accessibilityLabel = "إعادة محاولة الاتصال"
        reloadButton.addTarget(self, action: #selector(reloadPage), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [emblem, title, errorLabel, reloadButton])
        stack.axis = .vertical
        stack.alignment = .fill
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        errorPanel.addSubview(stack)

        NSLayoutConstraint.activate([
            errorPanel.topAnchor.constraint(equalTo: view.topAnchor),
            errorPanel.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            errorPanel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            errorPanel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.centerYAnchor.constraint(equalTo: errorPanel.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: errorPanel.safeAreaLayoutGuide.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: errorPanel.safeAreaLayoutGuide.trailingAnchor, constant: -28),
            emblem.heightAnchor.constraint(equalToConstant: 62),
            reloadButton.heightAnchor.constraint(equalToConstant: 54)
        ])
    }

    private func configureSplash() {
        splash.backgroundColor = EzzIOS.background
        splash.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(splash)

        let emblem = UILabel()
        emblem.text = "العز TV"
        emblem.textColor = .white
        emblem.font = .systemFont(ofSize: 46, weight: .heavy)
        emblem.textAlignment = .center
        emblem.layer.shadowColor = EzzIOS.crimson.cgColor
        emblem.layer.shadowOpacity = 0.45
        emblem.layer.shadowRadius = 16
        emblem.layer.shadowOffset = .zero
        emblem.translatesAutoresizingMaskIntoConstraints = false
        splash.addSubview(emblem)

        loading.color = EzzIOS.crimson
        loading.translatesAutoresizingMaskIntoConstraints = false
        splash.addSubview(loading)

        NSLayoutConstraint.activate([
            splash.topAnchor.constraint(equalTo: view.topAnchor),
            splash.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            splash.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            splash.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            emblem.centerXAnchor.constraint(equalTo: splash.centerXAnchor),
            emblem.centerYAnchor.constraint(equalTo: splash.centerYAnchor, constant: -32),
            loading.centerXAnchor.constraint(equalTo: splash.centerXAnchor),
            loading.topAnchor.constraint(equalTo: emblem.bottomAnchor, constant: 28)
        ])
        isSplashVisible = true
        loading.startAnimating()
        // The logo must not leave a customer behind a permanent splash screen.
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            self?.hideSplash()
        }
    }

    private func hideSplash() {
        guard isSplashVisible else { return }
        isSplashVisible = false
        loading.stopAnimating()
        UIView.animate(withDuration: 0.22, animations: {
            self.splash.alpha = 0
        }, completion: { _ in self.splash.removeFromSuperview() })
    }

    private func openHome() {
        errorPanel.isHidden = true
        browser.load(URLRequest(url: EzzIOS.home,
                                cachePolicy: .useProtocolCachePolicy,
                                timeoutInterval: 30))
    }

    @objc private func reloadPage() {
        errorPanel.isHidden = true
        refresh.endRefreshing()
        if browser.url == nil {
            openHome()
        } else {
            browser.reload()
        }
    }

    private func showFailure() {
        hideSplash()
        refresh.endRefreshing()
        errorLabel.text = "تحقق من اتصال الإنترنت. ستبقى بيانات تسجيل الدخول محفوظة على الجهاز."
        errorPanel.isHidden = false
    }

    private func trustedAppPage(_ url: URL) -> Bool {
        guard url.scheme == "https",
              let host = url.host?.lowercased() else { return false }
        if host == "app-apk-oquy.onrender.com" {
            return url.path == "/web" || url.path.hasPrefix("/web/")
        }
        return host == "youef.github.io" &&
               (url.path == "/app_apk/web" || url.path.hasPrefix("/app_apk/web/"))
    }

    private func openExternal(_ url: URL) {
        guard url.scheme == "https" else { return }
        let safari = SFSafariViewController(url: url)
        safari.preferredControlTintColor = EzzIOS.crimson
        present(safari, animated: true)
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if let frame = navigationAction.targetFrame, !frame.isMainFrame {
            decisionHandler(.allow) // Embedded licensed media is handled by WebKit.
            return
        }
        if trustedAppPage(url) || url.scheme == "about" || url.scheme == "blob" {
            decisionHandler(.allow)
        } else if url.scheme == "https" && navigationAction.navigationType == .linkActivated {
            decisionHandler(.cancel)
            openExternal(url)
        } else {
            decisionHandler(.cancel) // Do not navigate out of the viewer during a silent redirect.
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hideSplash()
        refresh.endRefreshing()
        errorPanel.isHidden = true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!,
                 withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showFailure() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showFailure() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        browser.reload()
    }

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil,
           let url = navigationAction.request.url,
           url.scheme == "https" {
            if trustedAppPage(url) {
                browser.load(URLRequest(url: url))
            } else {
                openExternal(url)
            }
        }
        return nil
    }
}
