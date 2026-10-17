import AppKit
import ImageIO
import SwiftUI

extension Notification.Name {
    /// Back to the projects home from anywhere in the app.
    static let showProjectsHome = Notification.Name("showProjectsHome")
}

/// The first screen: every project as a card, like Figma's or Framer's file browser. A project is a brand of
/// its own, with its own TikTok and Instagram, so each card shows which accounts it has.
struct ProjectsHome<Settings: View>: View {
    enum Section { case projects, trash, settings }

    /// Which page the sidebar shows; ⌘, lands on the settings here without leaving home.
    @Binding var section: Section
    /// The app's settings page, shown in place of the grid.
    @ViewBuilder let settings: () -> Settings
    /// Opens the main app on the project just opened.
    let enter: () -> Void

    @Bindable private var store = ProjectStore.shared
    @ObservedObject private var sessions = SocialSessions.shared
    @State private var search = ""
    @State private var naming = ProcessInfo.processInfo.arguments.contains("--product-setup")
    @State private var editingProduct: ProjectFolder?
    @State private var renaming: ProjectFolder?
    @State private var renameText = ""
    @State private var actionError: String?

    private var shown: [ProjectFolder] {
        let query = search.trimmingCharacters(in: .whitespaces)
        let sorted = store.projects.sorted { $0.project.created > $1.project.created }
        return query.isEmpty ? sorted : sorted.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Group {
                switch section {
                case .projects: content
                case .trash: ProjectsTrashView(store: store)
                case .settings: settings().frame(maxWidth: .infinity, maxHeight: .infinity).background(.black.opacity(0.72))
                }
            }
            .transition(.opacity)
        }
        .animation(.snappy(duration: 0.2), value: section)
        .environment(\.colorScheme, .dark)
        .foregroundStyle(.white)
        .onAppear { store.maintainTrash() }
        .overlay {
            if naming || editingProduct != nil {
                ZStack {
                    ModalBackdrop { closeProductSetup() }.ignoresSafeArea()
                    ProjectProductSetup(store: store, project: editingProduct, cancel: closeProductSetup) {
                        let created = naming
                        closeProductSetup()
                        if created { enter() }
                    }
                }
            } else if let target = renaming {
                ZStack {
                    ModalBackdrop { renaming = nil }.ignoresSafeArea()
                    VStack(alignment: .leading, spacing: 18) {
                        Text("Renomear projeto").font(.system(size: 18, weight: .semibold))
                        TextField("Nome", text: $renameText)
                            .textFieldStyle(.plain)
                            .modalField()
                            .onSubmit {
                                store.rename(target, to: renameText)
                                renaming = nil
                            }
                        HStack(spacing: 10) {
                            Spacer()
                            Button("Cancelar") { renaming = nil }
                                .buttonStyle(.appSecondary)
                            Button("Salvar") {
                                store.rename(target, to: renameText)
                                renaming = nil
                            }
                            .buttonStyle(.appPrimary)
                            .keyboardShortcut(.defaultAction)
                        }
                    }
                    .padding(24)
                    .frame(width: 360)
                    .modalPanel()
                }
            }
        }
    }

    // MARK: Sidebar

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("The Carousel Maker").font(.system(size: 14, weight: .semibold)).lineLimit(1)
            .padding(.horizontal, 10).padding(.bottom, 14)

            Button { naming = true } label: {
                Label("Novo projeto", systemImage: "plus")
            }
            .buttonStyle(.appPrimary)
            .padding(.horizontal, 10).padding(.bottom, 10)

            sidebarRow("Todos os projetos", icon: "square.grid.2x2", selected: section == .projects) { section = .projects }

            Text("Projetos")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(0.45))
                .padding(.horizontal, 10).padding(.top, 18).padding(.bottom, 4)
            ScrollView {
                VStack(spacing: 2) {
                    ForEach(shown) { project in
                        sidebarRow(project.name, icon: "folder", selected: false) { open(project) }
                            .contextMenu { projectActions(project) }
                    }
                }
            }
            Spacer(minLength: 0)
            sidebarRow("Lixeira", icon: "trash", selected: section == .trash) { section = .trash }
                .accessibilityIdentifier("projects-trash-button")
            sidebarRow("Ajustes", icon: "gearshape", selected: section == .settings) { section = .settings }
        }
        // Clear of the window's traffic lights.
        .padding(.top, 52).padding(.horizontal, 10).padding(.bottom, 14)
        .frame(width: 240)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(.black.opacity(0.6))
        .overlay(alignment: .trailing) { Rectangle().fill(.white.opacity(0.08)).frame(width: 1) }
    }

    private func sidebarRow(_ title: String, icon: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 13)).frame(width: 18)
                Text(title).font(.system(size: 13, weight: selected ? .semibold : .regular)).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10).frame(height: 30)
            .foregroundStyle(selected ? .white : .white.opacity(0.75))
            .background(RoundedRectangle(cornerRadius: 8).fill(.white.opacity(selected ? 0.1 : 0)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Grid

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text("Todos os projetos").font(.system(size: 22, weight: .bold))
                Spacer()
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
                    TextField("Buscar", text: $search).textFieldStyle(.plain).font(.system(size: 13))
                }
                .padding(.horizontal, 10).frame(width: 220, height: 30)
                .background(RoundedRectangle(cornerRadius: 8).fill(.white.opacity(0.08)))
            }
            .padding(.horizontal, 32).padding(.top, 40).padding(.bottom, 20)

            if let actionError {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.yellow)
                    Text(actionError).font(.system(size: 13))
                    Spacer()
                    Button { self.actionError = nil } label: { Image(systemName: "xmark") }
                        .buttonStyle(.appIcon).controlSize(.small)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 12).fill(.red.opacity(0.2)))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.red.opacity(0.4)))
                .padding(.horizontal, 32).padding(.bottom, 12)
            }

            if shown.isEmpty && !search.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "magnifyingglass").font(.system(size: 32, weight: .light))
                    Text("Nenhum projeto encontrado").font(.system(size: 16, weight: .medium))
                    Text("Tente buscar por outro termo.").font(.system(size: 13)).foregroundStyle(.white.opacity(0.55))
                }
                .foregroundStyle(.white.opacity(0.75))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 200, maximum: 280), spacing: 20, alignment: .top)],
                              alignment: .leading, spacing: 28) {
                        if search.isEmpty { newTile }
                        ForEach(shown) { project in
                            ProjectCard(project: project, isCurrent: project.id == store.current.id,
                                        open: { open(project) },
                                        connect: { network in connect(network, in: project) })
                                .overlay(alignment: .topTrailing) {
                                    Menu { projectActions(project) } label: {
                                        Image(systemName: "ellipsis")
                                    }
                                    .menuStyle(.button).buttonStyle(.appIcon).menuIndicator(.hidden)
                                    .fixedSize()
                                    .help("Opções de \(project.name)")
                                    .accessibilityLabel("Opções de \(project.name)")
                                    .padding(10)
                                }
                                .contextMenu { projectActions(project) }
                        }
                    }
                    .padding(.horizontal, 32).padding(.bottom, 40)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black.opacity(0.72))
    }

    private var newTile: some View {
        Button { naming = true } label: {
            VStack(alignment: .leading, spacing: 10) {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(.white.opacity(0.22), style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                    .aspectRatio(4 / 5, contentMode: .fit)
                    .overlay {
                        VStack(spacing: 8) {
                            Image(systemName: "plus").font(.system(size: 26, weight: .light))
                            Text("Novo projeto").font(.system(size: 13, weight: .medium))
                        }
                        .foregroundStyle(.white.opacity(0.7))
                    }
                Text(" ").font(.system(size: 13, weight: .semibold))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Actions

    private func closeProductSetup() {
        naming = false
        editingProduct = nil
    }

    @ViewBuilder private func projectActions(_ project: ProjectFolder) -> some View {
        Button("Abrir") { open(project) }
        Button("Editar produto…") { editingProduct = project }
        Button("Renomear…") { renameText = project.name; renaming = project }
        Button("Mostrar no Finder") { store.reveal(project) }
        Divider()
        Button("Mover para a lixeira", role: .destructive) {
            do { try store.moveToTrash(project) } catch { actionError = error.localizedDescription }
        }
    }

    private func open(_ project: ProjectFolder) {
        store.open(project)
        enter()
    }

    /// Logins belong to the open project, so the project opens first and the login sheet follows.
    private func connect(_ network: SocialNetwork, in project: ProjectFolder) {
        open(project)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { sessions.signingIn = network }
    }
}

/// One project: its latest slide as the cover, its name, and its TikTok and Instagram.
private struct ProjectCard: View {
    let project: ProjectFolder
    let isCurrent: Bool
    let open: () -> Void
    let connect: (SocialNetwork) -> Void

    @State private var cover: NSImage?
    @State private var icon: NSImage?
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            coverView
                .aspectRatio(4 / 5, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(hovering ? Color.accentColor : .white.opacity(0.1), lineWidth: hovering ? 2 : 1)
                }
                .contentShape(Rectangle())
                .onTapGesture(perform: open)
            HStack(alignment: .top, spacing: 8) {
                if let icon {
                    Image(nsImage: icon).resizable().interpolation(.high).scaledToFit()
                        .frame(width: 28, height: 28)
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(project.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    Text(subtitle).font(.system(size: 11)).foregroundStyle(.white.opacity(0.5)).lineLimit(1)
                }
                Spacer(minLength: 4)
                HStack(spacing: 4) {
                    ForEach(SocialNetwork.allCases, id: \.self) { network in account(network) }
                }
            }
        }
        .onHover { hovering = $0 }
        .animation(.snappy(duration: 0.15), value: hovering)
        .task(id: project.id) {
            icon = NSImage(contentsOf: project.iconFile)
            cover = await ProjectCover.load(for: project)
        }
    }

    @ViewBuilder private var coverView: some View {
        if let cover {
            Color.clear.overlay { Image(nsImage: cover).resizable().scaledToFill() }
        } else {
            LinearGradient(colors: [.white.opacity(0.1), .white.opacity(0.04)], startPoint: .top, endPoint: .bottom)
                .overlay {
                    Text(project.name.prefix(1).uppercased())
                        .font(.system(size: 44, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.35))
                }
        }
    }

    private var subtitle: String {
        isCurrent ? "Aberto por último" : "Criado " + project.project.created.formatted(.relative(presentation: .named).locale(Locale(identifier: "pt_BR")))
    }

    /// Lit when the project is signed in; dim with a tap to connect when it isn't.
    private func account(_ network: SocialNetwork) -> some View {
        let handle = SocialSessions.cachedHandle(network, project: project.id)
        return SocialMark(network: network, size: 20)
            .saturation(handle == nil ? 0 : 1)
            .opacity(handle == nil ? 0.35 : 1)
            .contentShape(Rectangle())
            .onTapGesture { if handle == nil { connect(network) } else { open() } }
            .help(handle.map { "\(network.title): \($0)" } ?? "Conectar \(network.title)")
    }
}

/// The newest image in the project's output, shrunk for a card.
enum ProjectCover {
    static func load(for project: ProjectFolder) async -> NSImage? {
        let folder = project.project.selection?.output.map { URL(fileURLWithPath: $0) } ?? project.defaultOutput
        return await Task.detached(priority: .utility) { () -> NSImage? in
            guard let newest = newestImage(in: folder),
                  let source = CGImageSourceCreateWithURL(newest as CFURL, nil),
                  let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                      kCGImageSourceCreateThumbnailFromImageAlways: true,
                      kCGImageSourceCreateThumbnailWithTransform: true,
                      kCGImageSourceThumbnailMaxPixelSize: 640
                  ] as CFDictionary) else { return nil }
            return NSImage(cgImage: image, size: .zero)
        }.value
    }

    nonisolated static func newestImage(in folder: URL) -> URL? {
        let keys: [URLResourceKey] = [.contentModificationDateKey, .isRegularFileKey]
        guard let walker = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: keys,
                                                          options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return nil }
        var best: (url: URL, date: Date)?
        var seen = 0
        for case let url as URL in walker {
            seen += 1
            if seen > 5_000 { break }
            guard ["png", "jpg", "jpeg", "webp", "heic"].contains(url.pathExtension.lowercased()),
                  let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true else { continue }
            let date = values.contentModificationDate ?? .distantPast
            if date > (best?.date ?? .distantPast) || best == nil { best = (url, date) }
        }
        return best?.url
    }
}
