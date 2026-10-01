import SwiftUI

/// Top-left pill with the open project; the popover lists every project and creates new ones.
struct ProjectSwitcher: View {
    @Bindable var store = ProjectStore.shared
    @State private var isOpen = false
    @State private var newName = ""
    @State private var renaming: UUID?
    @State private var renameText = ""
    @FocusState private var focusedField: Field?

    private enum Field: Hashable { case create, rename }

    var body: some View {
        Button { isOpen.toggle() } label: {
            HStack(spacing: 8) {
                Image(systemName: "folder.fill").font(.system(size: 13, weight: .semibold))
                // Hugs the name; a long one truncates instead of stretching the pill.
                Text(store.current.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    .frame(maxWidth: 170)
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
                    .rotationEffect(.degrees(isOpen ? 180 : 0))
            }
            .padding(.horizontal, 14).frame(height: 36)
            .fixedSize()
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .help("Trocar de projeto")
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isOpen)
        .popover(isPresented: $isOpen, arrowEdge: .bottom) { list }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Projetos").font(.system(size: 15, weight: .bold)).padding(.horizontal, 10).padding(.bottom, 4)
            ScrollView {
                VStack(spacing: 2) {
                    ForEach(store.projects) { project in row(project) }
                }
            }
            .frame(maxHeight: 320)
            .fixedSize(horizontal: false, vertical: true)
            Divider().padding(.vertical, 6)
            HStack(spacing: 8) {
                Image(systemName: "plus").font(.system(size: 13, weight: .bold)).frame(width: 18)
                TextField("Novo projeto", text: $newName)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium))
                    .focused($focusedField, equals: .create)
                    .onSubmit(create)
                if !newName.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button("Criar", action: create)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                }
            }
            .padding(.horizontal, 10).frame(height: 36)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.06)))
        }
        .padding(12)
        .frame(width: 300)
    }

    private func row(_ project: ProjectFolder) -> some View {
        let isCurrent = project.id == store.current.id
        return HStack(spacing: 10) {
            Image(systemName: isCurrent ? "folder.fill" : "folder")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isCurrent ? Color.accentColor : .primary)
                .frame(width: 18)
            if renaming == project.id {
                TextField("Nome", text: $renameText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .semibold))
                    .focused($focusedField, equals: .rename)
                    .onSubmit { finishRename(project) }
                    .onExitCommand { renaming = nil }
            } else {
                Text(project.name).font(.system(size: 14, weight: isCurrent ? .semibold : .medium)).lineLimit(1)
            }
            Spacer(minLength: 8)
            if isCurrent && renaming == nil {
                Button { startRename(project) } label: { Image(systemName: "pencil") }
                    .buttonStyle(.plain)
                    .help("Renomear")
                Button { store.reveal(project) } label: { Image(systemName: "arrow.up.forward.square") }
                    .buttonStyle(.plain)
                    .help("Abrir a pasta no Finder")
            }
        }
        .font(.system(size: 13, weight: .semibold))
        .padding(.horizontal, 10).frame(height: 36)
        .background(RoundedRectangle(cornerRadius: 10).fill(isCurrent ? Color.accentColor.opacity(0.14) : .clear))
        .contentShape(Rectangle())
        .onTapGesture {
            guard renaming == nil else { return }
            store.open(project)
            isOpen = false
        }
    }

    private func create() {
        guard !newName.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        store.create(named: newName)
        newName = ""
        isOpen = false
    }

    private func startRename(_ project: ProjectFolder) {
        renameText = project.name
        renaming = project.id
        focusedField = .rename
    }

    private func finishRename(_ project: ProjectFolder) {
        store.rename(project, to: renameText)
        renaming = nil
    }
}
