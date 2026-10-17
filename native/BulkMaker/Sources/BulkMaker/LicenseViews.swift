import SwiftUI

private var licenseSecondaryInk: Color { Color.primary.opacity(0.76) }

/// This is a native account screen, using the app's native macOS controls.
struct LicenseActivationView: View {
  @ObservedObject var license: License
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var appeared = false
  @State private var enteringKey = false
  @State private var key = ""
  @FocusState private var keyFocused: Bool

  var body: some View {
    GeometryReader { geometry in
      ZStack {
        ModalBackdrop(close: close).ignoresSafeArea()
        VStack(spacing: 0) {
          ModalHeader(title: "Conta e assinatura", done: close)
          ScrollView {
            VStack(alignment: .leading, spacing: 24) {
              VStack(alignment: .leading, spacing: 8) {
                Text("The Carousel Maker").font(.system(size: 25, weight: .semibold))
                Text(
                  license.access.isAllowed
                    ? "Tudo pronto para criar." : "Seu próximo carrossel começa aqui."
                )
                .font(.title3)
              }

              if license.canStartTrial {
                VStack(alignment: .leading, spacing: 10) {
                  Text("7 dias para experimentar").font(.headline)
                  Text(
                    "Sem cartão e sem cobrança automática. Você precisa de Claude Code ou Codex instalado e conectado à sua própria assinatura."
                  )
                  .foregroundStyle(licenseSecondaryInk).fixedSize(horizontal: false, vertical: true)
                  Button("Começar teste grátis") { license.startTrial() }
                    .buttonStyle(.appPrimary)
                    .disabled(license.isBusy)
                    .accessibilityIdentifier("license.startTrial")
                }
              } else {
                LicenseStatusView(license: license)
              }

              VStack(alignment: .leading, spacing: 12) {
                if enteringKey && !license.hasActivation {
                  Text("Chave de licença").font(.headline)
                  SecureField("Cole a chave recebida por e-mail", text: $key)
                    .textFieldStyle(.plain).modalField()
                    .focused($keyFocused)
                    .accessibilityIdentifier("license.key")
                    .onSubmit { activate() }
                  .onKeyPress(.return) {
                    activate()
                    return .handled
                  }
                  Button(license.isBusy ? "Ativando…" : "Ativar neste Mac", action: activate)
                    .buttonStyle(.appPrimary)
                    .disabled(
                      key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || license.isBusy
                    )
                    .accessibilityIdentifier("license.activate")
                } else if !license.hasActivation {
                  Button("Já tenho uma chave") {
                    enteringKey = true
                    keyFocused = true
                  }
                  .buttonStyle(.appSecondary)
                  .accessibilityIdentifier("license.enterKey")
                }
                if let checkout = license.configuration.checkoutURL, checkout.scheme == "https" {
                  Button("Entrar na lista de espera") { license.openCheckout() }
                    .buttonStyle(.appSecondary)
                }
              }

              if let message = license.message {
                Text(message).foregroundStyle(.primary)
                  .fixedSize(horizontal: false, vertical: true)
                  .accessibilityIdentifier("license.message")
              }
              if license.storageFailed {
                Button("Tentar novamente") { Task { await license.retryStorage() } }
                  .buttonStyle(.appSecondary)
                  .disabled(license.isBusy)
              }
              HStack {
                Text(
                  "Seus arquivos continuam seus.\nVocê pode abrir e exportar mesmo sem assinatura."
                )
                .font(.callout).foregroundStyle(licenseSecondaryInk)
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 20)
                Button(license.access.isAllowed ? "Continuar" : "Abrir meus arquivos") {
                  license.showsActivation = false
                }
                .buttonStyle(license.access.isAllowed && !license.canStartTrial ? .appPrimary : .appSecondary)
                .keyboardShortcut(.cancelAction)
                .accessibilityIdentifier("license.openExisting")
              }
            }
            .padding(.horizontal, 28).padding(.top, 14).padding(.bottom, 28)
          }
        }
        .frame(
          width: min(580, max(280, geometry.size.width - 48)),
          height: min(560, max(300, geometry.size.height - 48))
        )
        .background(RoundedRectangle(cornerRadius: 26).fill(.black.opacity(0.2)))
        .modalPanel()
        .modalAppearance(appeared)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .onAppear { withAnimation(reduceMotion ? nil : .modalAppear) { appeared = true } }
    .onDisappear { key = "" }
  }

  private func close() { license.showsActivation = false }

  private func activate() {
    guard !key.isEmpty, !license.isBusy else { return }
    let submitted = key
    key = ""
    Task { await license.activate(key: submitted) }
  }
}

struct LicenseStatusView: View {
  @ObservedObject var license: License

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.headline)
      switch license.access {
      case .trial(let end):
        Text("Disponível até \(end.formatted(date: .abbreviated, time: .shortened)).")
      case .offline(let end):
        Text(
          "Sem conexão com o serviço. Acesso disponível até \(end.formatted(date: .abbreviated, time: .shortened))."
        )
      case .locked(let reason): Text(reason)
      case .notStarted: Text("Comece o teste ou ative sua chave para gerar, pesquisar e organizar.")
      case .active: Text("Licença validada para este Mac. Até 2 Macs por assinatura.")
      }
    }
    .fixedSize(horizontal: false, vertical: true)
  }

  private var title: String {
    switch license.access {
    case .notStarted: "Ative para começar"
    case .trial: "Teste grátis em andamento"
    case .active: "Assinatura ativa"
    case .offline: "Acesso offline"
    case .locked: "Modo de consulta e exportação"
    }
  }
}

struct LicenseAccountView: View {
  @ObservedObject var license: License

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      LicenseStatusView(license: license)
      if let credentials = license.record.credentials {
        Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 12) {
          row("E-mail", value: credentials.entitlement.email)
          row("Plano", value: credentials.entitlement.plan)
          row("Macs ativados", value: "\(credentials.entitlement.activationUsage) de 2")
          row(
            "Renovação",
            value: credentials.entitlement.renewsAt.map {
              $0.formatted(date: .abbreviated, time: .omitted)
            } ?? "Consulte no portal da assinatura")
          row(
            "Última validação",
            value: credentials.validatedAt.formatted(date: .abbreviated, time: .shortened))
        }
        .textSelection(.enabled)
        HStack(spacing: 16) {
          Button(license.isBusy ? "Validando…" : "Validar agora") {
            Task { await license.revalidate() }
          }
          .buttonStyle(.appSecondary)
          .disabled(license.isBusy || license.storageFailed)
          Button("Gerenciar assinatura") { license.openPortal() }
            .buttonStyle(.appSecondary)
            .disabled(license.configuration.portalURL == nil)
        }
        Button("Desativar neste Mac", role: .destructive) { Task { await license.deactivate() } }
          .buttonStyle(.appSecondary)
          .disabled(license.isBusy)
      } else {
        Button(license.canStartTrial ? "Começar teste ou ativar chave" : "Ativar uma chave") {
          license.showsActivation = true
        }
        .buttonStyle(.appPrimary)
      }
      if let message = license.message {
        Text(message).font(.callout).fixedSize(horizontal: false, vertical: true)
      }
      if license.storageFailed {
        Button("Tentar novamente") { Task { await license.retryStorage() } }
          .buttonStyle(.appSecondary)
          .disabled(license.isBusy)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func row(_ label: String, value: String) -> some View {
    GridRow(alignment: .top) {
      Text(label).foregroundStyle(licenseSecondaryInk)
      Text(value).fixedSize(horizontal: false, vertical: true)
    }
  }
}

extension Notification.Name {
  static let showProductSettings = Notification.Name("showProductSettings")
}

struct LicenseLifecycle: ViewModifier {
  @ObservedObject var license = License.shared

  func body(content: Content) -> some View {
    content
      .onAppear {
        license.startMonitoring()
        AppUpdates.shared.start()
        #if DEBUG
          if ProcessInfo.processInfo.arguments.contains("--license-preview") {
            Task { @MainActor in license.showsActivation = true }
          }
        #endif
      }
      .overlay {
        if license.showsActivation { LicenseActivationView(license: license) }
      }
  }
}
