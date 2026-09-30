import Foundation

// SwiftPM generates `Bundle.module` for the package build; in the Xcode app target the resources
// are copied straight into the app, so `Bundle.module` is simply the main bundle.
extension Bundle {
    static let module = Bundle.main
}
