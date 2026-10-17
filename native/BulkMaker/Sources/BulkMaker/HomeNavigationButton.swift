import SwiftUI

/// Returns directly to the projects home from any workspace page.
struct HomeNavigationButton: View {
    var body: some View {
        Button {
            NotificationCenter.default.post(name: .showProjectsHome, object: nil)
        } label: {
            Label("Início", systemImage: "house")
        }
        .buttonStyle(.appSecondary)
        .help("Voltar para todos os projetos")
        .accessibilityIdentifier("projects-home-button")
    }
}
