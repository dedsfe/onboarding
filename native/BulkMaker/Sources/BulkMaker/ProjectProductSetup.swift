import AppKit
import Observation
import SwiftUI

/// A draft stays separate from the selected project until the person confirms it.
@MainActor @Observable
final class ProjectProductDraft {
    var profile: ProductProfile
    var reading = false
    var status: String?
    var iconData: Data?
    private var task: Task<Void, Never>?
    private var requestID = UUID()
    private let readPage: (URL) async throws -> SiteSnapshot
    private let understandPage: (SiteSnapshot) async throws -> ProductProfile

    init(project: ProjectFolder? = nil,
         readPage: @escaping (URL) async throws -> SiteSnapshot = SiteSnapshot.read,
         understandPage: @escaping (SiteSnapshot) async throws -> ProductProfile = ProductUnderstanding.understand) {
        self.readPage = readPage
        self.understandPage = understandPage
        var profile = project?.project.profile ?? ProductProfile()
        if let project {
            profile.name = project.name
            profile.site = project.project.site ?? profile.site
            if profile.whatItDoes.isEmpty { profile.whatItDoes = project.project.about ?? "" }
        }
        self.profile = profile
    }

    var confirmedProfile: ProductProfile? {
        var result = profile
        result.name = result.name.trimmingCharacters(in: .whitespacesAndNewlines)
        result.whatItDoes = result.whatItDoes.trimmingCharacters(in: .whitespacesAndNewlines)
        result.audience = result.audience.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !result.name.isEmpty, !result.whatItDoes.isEmpty,
              let url = Self.productURL(result.site) else { return nil }
        result.site = url.absoluteString
        return result
    }

    static func productURL(_ text: String) -> URL? {
        guard let url = SiteSnapshot.normalize(text), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.user == nil, url.password == nil else { return nil }
        return url
    }

    func readSite(
        read: ((URL) async throws -> SiteSnapshot)? = nil,
        understand: ((SiteSnapshot) async throws -> ProductProfile)? = nil
    ) {
        cancelReading()
        guard let url = Self.productURL(profile.site) else {
            status = "Confira o link do produto, por exemplo: seusite.com.br."
            return
        }
        let id = requestID
        let read = read ?? readPage
        let understand = understand ?? understandPage
        reading = true
        status = "Lendo a página…"
        task = Task {
            defer { if id == requestID { reading = false } }
            do {
                let snapshot = try await read(url)
                guard !Task.isCancelled, id == requestID else { return }
                var basic = ProductProfile()
                basic.site = url.absoluteString
                basic.name = snapshot.name
                basic.whatItDoes = snapshot.description ?? ""
                profile = basic
                iconData = snapshot.iconData
                status = "Entendendo o produto com a sua IA…"
                do {
                    var enriched = try await understand(snapshot)
                    guard !Task.isCancelled, id == requestID else { return }
                    // Keep the exact product link, including an App Store ID or page path.
                    enriched.site = url.absoluteString
                    if enriched.name.isEmpty { enriched.name = basic.name }
                    if enriched.whatItDoes.isEmpty { enriched.whatItDoes = basic.whatItDoes }
                    profile = enriched
                    status = "Confira os dados antes de continuar."
                } catch {
                    guard !Task.isCancelled, id == requestID else { return }
                    status = "Li a página, mas a IA não concluiu o resumo. Complete os dados abaixo."
                }
            } catch {
                guard !Task.isCancelled, id == requestID else { return }
                status = "Não consegui ler esse site. Você pode preencher os dados abaixo e continuar."
            }
        }
    }

    func cancelReading() {
        requestID = UUID()
        task?.cancel()
        task = nil
        reading = false
        status = nil
    }
}

/// The product portion of onboarding, available for every project without repeating account setup.
struct ProjectProductSetup: View {
    let store: ProjectStore
    var project: ProjectFolder? = nil
    let cancel: () -> Void
    let saved: () -> Void
    var onControlFrame: ((String, CGRect) -> Void)? = nil
    @State private var draft: ProjectProductDraft
    @State private var saveError: String?
    @FocusState private var focused: Field?
    private enum Field: Hashable { case site, name, description, audience }

    init(store: ProjectStore, project: ProjectFolder? = nil, draft: ProjectProductDraft? = nil,
         cancel: @escaping () -> Void, saved: @escaping () -> Void,
         onControlFrame: ((String, CGRect) -> Void)? = nil) {
        self.store = store
        self.project = project
        self.cancel = cancel
        self.saved = saved
        self.onControlFrame = onControlFrame
        _draft = State(initialValue: draft ?? ProjectProductDraft(project: project))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(project == nil ? "Novo projeto" : "Editar produto")
                        .font(.system(size: 20, weight: .semibold))
                    Text("Conte à IA o que você vende.")
                        .font(.system(size: 13)).foregroundStyle(.white.opacity(0.65))
                }
                Spacer(minLength: 0)
                Button(action: dismiss) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.appIcon)
                .accessibilityLabel("Fechar cadastro de produto")
                .trackProductControl("close", report: onControlFrame)
            }
            .padding(24)

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Site ou página do produto").font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.white.opacity(0.75))
                        HStack(spacing: 10) {
                            TextField("seusite.com.br", text: $draft.profile.site)
                                .textFieldStyle(.plain).modalField()
                                .focused($focused, equals: .site)
                                .accessibilityLabel("Link do produto")
                                .accessibilityIdentifier("product-site")
                                .disabled(draft.reading)
                            Button {
                                if draft.reading { draft.cancelReading() } else { draft.readSite() }
                            } label: {
                                HStack(spacing: 8) {
                                    if draft.reading { ProgressView().controlSize(.small) }
                                    Text(draft.reading ? "Parar" : "Ler site")
                                }
                            }
                            .buttonStyle(.appSecondary)
                            .disabled(!draft.reading && ProjectProductDraft.productURL(draft.profile.site) == nil)
                            .trackProductControl("read", report: onControlFrame)
                        }
                        if let status = draft.status {
                            Text(status).font(.system(size: 12)).foregroundStyle(.white.opacity(0.7))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        field("Nome do projeto", placeholder: "Nome do produto ou da marca", text: $draft.profile.name, field: .name)
                        field("Sobre o produto", placeholder: "O que ele faz e qual problema resolve?", text: $draft.profile.whatItDoes,
                              field: .description, lines: 3...5)
                        field("Público", placeholder: "Quem você quer alcançar? (opcional)", text: $draft.profile.audience,
                              field: .audience, lines: 1...3)
                    }
                    .disabled(draft.reading)
                }
                .padding(.horizontal, 24).padding(.bottom, 16)
            }
            .scrollIndicators(.never)
            .scrollEdgeEffectStyle(.soft, for: [.top, .bottom])

            HStack(spacing: 12) {
                if let saveError {
                    Text(saveError).font(.system(size: 12)).foregroundStyle(.red).lineLimit(2)
                } else {
                    Text("Contexto salvo só neste projeto.")
                        .font(.system(size: 12)).foregroundStyle(.white.opacity(0.6))
                }
                Spacer(minLength: 0)
                Button("Cancelar", action: dismiss)
                    .buttonStyle(.appSecondary)
                    .keyboardShortcut(.cancelAction)
                    .trackProductControl("cancel", report: onControlFrame)
                Button(project == nil ? "Criar projeto" : "Salvar", action: save)
                    .buttonStyle(.appPrimary)
                    .keyboardShortcut(.defaultAction)
                    .disabled(draft.confirmedProfile == nil || draft.reading)
                    .accessibilityIdentifier("save-project-product")
                    .trackProductControl("save", report: onControlFrame)
            }
            .padding(24)
        }
        .frame(width: 560, height: min(568, (NSScreen.main?.visibleFrame.height ?? 728) - 160))
        .modalPanel()
        .coordinateSpace(name: "project-product")
        .onAppear { focused = .site }
        .onDisappear { draft.cancelReading() }
        .onExitCommand(perform: dismiss)
    }

    private func field(_ title: String, placeholder: String, text: Binding<String>, field: Field,
                       lines: ClosedRange<Int> = 1...1) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(0.75))
            TextField(placeholder, text: text, axis: .vertical)
                .lineLimit(lines).focused($focused, equals: field)
                .textFieldStyle(.plain).modalField()
                .accessibilityLabel(title)
                .accessibilityIdentifier("product-\(field)")
        }
    }

    private func dismiss() {
        draft.cancelReading()
        cancel()
    }

    private func save() {
        guard !draft.reading, let profile = draft.confirmedProfile else { return }
        do {
            if let project {
                try store.updateProduct(profile, in: project)
            } else {
                try store.createProduct(profile)
            }
            if let data = draft.iconData, let image = NSImage(data: data), let tiff = image.tiffRepresentation,
               let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                let destination = project?.iconFile ?? store.current.iconFile
                try? png.write(to: destination, options: .atomic)
            }
            saved()
        } catch { saveError = error.localizedDescription }
    }
}

private extension View {
    func trackProductControl(_ id: String, report: ((String, CGRect) -> Void)?) -> some View {
        onGeometryChange(for: CGRect.self) { $0.frame(in: .named("project-product")) } action: { report?(id, $0) }
    }
}
