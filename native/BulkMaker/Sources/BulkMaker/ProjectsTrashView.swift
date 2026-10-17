import SwiftUI

struct ProjectsTrashView: View {
    @Bindable var store: ProjectStore
    var onControlFrame: ((String, CGRect) -> Void)? = nil
    @State private var confirmingDeletion = false
    @State private var pendingDeletion: [ProjectFolder] = []
    @State private var actionError: String?

    private var projects: [ProjectFolder] {
        store.trashedProjects.sorted { ($0.project.trashedAt ?? .distantPast) > ($1.project.trashedAt ?? .distantPast) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text("Lixeira").font(.system(size: 22, weight: .bold))
                Spacer()
                if !projects.isEmpty {
                    Button("Esvaziar lixeira…") { confirmDeletion(projects) }
                        .buttonStyle(.appSecondary)
                        .accessibilityIdentifier("empty-projects-trash")
                        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("projects-trash")) } action: {
                            onControlFrame?("empty", $0)
                        }
                }
            }
            Text("Projetos ficam aqui por 30 dias. Você pode restaurar ou excluir definitivamente antes disso.")
                .font(.system(size: 13)).foregroundStyle(.white.opacity(0.75))
                .fixedSize(horizontal: false, vertical: true)

            if let actionError {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.yellow)
                    Text(actionError).font(.system(size: 13)).foregroundStyle(.white)
                    Spacer()
                    Button { self.actionError = nil } label: { Image(systemName: "xmark") }
                        .buttonStyle(.appIcon).controlSize(.small)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12).fill(.red.opacity(0.2)))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.red.opacity(0.4)))
            }

            if let error = store.trashCleanupError {
                Text(error).font(.system(size: 13)).foregroundStyle(.white)
                Button("Tentar limpar novamente") { store.maintainTrash() }
                    .buttonStyle(.appSecondary)
            }

            if projects.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "trash").font(.system(size: 28, weight: .light))
                    Text("A lixeira está vazia").font(.system(size: 16, weight: .medium))
                }
                .foregroundStyle(.white.opacity(0.75))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(projects) { project in
                            ViewThatFits(in: .horizontal) {
                                HStack(spacing: 20) {
                                    details(project)
                                    Spacer(minLength: 16)
                                    actions(project)
                                }
                                VStack(alignment: .leading, spacing: 14) {
                                    details(project)
                                    actions(project)
                                }
                            }
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.white.opacity(0.06), in: .rect(cornerRadius: 14))
                        }
                    }
                    .padding(.bottom, 20)
                }
                Text("A limpeza automática acontece ao abrir o app e enquanto ele está em uso.")
                    .font(.system(size: 12)).foregroundStyle(.white.opacity(0.65))
            }
        }
        .padding(.horizontal, 32).padding(.top, 40).padding(.bottom, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(.black.opacity(0.72))
        .coordinateSpace(name: "projects-trash")
        .alert("Excluir definitivamente?", isPresented: $confirmingDeletion) {
            Button("Cancelar", role: .cancel) { pendingDeletion = [] }
            Button("Excluir definitivamente", role: .destructive) {
                let targets = pendingDeletion
                pendingDeletion = []
                for project in targets {
                    do { try store.deletePermanently(project) }
                    catch { actionError = error.localizedDescription }
                }
            }
        } message: {
            Text(pendingDeletion.count == 1
                 ? "O projeto \(pendingDeletion.first?.name ?? "") e os arquivos dentro dele serão apagados. Esta ação não pode ser desfeita."
                 : "Os \(pendingDeletion.count) projetos da lixeira e os arquivos dentro deles serão apagados. Esta ação não pode ser desfeita.")
        }
    }

    private func details(_ project: ProjectFolder) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(project.name).font(.system(size: 14, weight: .semibold))
                .lineLimit(2).help(project.name)
            if let expires = project.trashExpiresAt {
                Text("Exclusão automática em \(expires.formatted(.dateTime.day().month(.wide).year().locale(Locale(identifier: "pt_BR"))))")
                    .font(.system(size: 12)).foregroundStyle(.white.opacity(0.7))
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func actions(_ project: ProjectFolder) -> some View {
        HStack(spacing: 10) {
            Button("Restaurar") {
                do { try store.restore(project) } catch { actionError = error.localizedDescription }
            }
            .buttonStyle(.appSecondary)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("projects-trash")) } action: {
                onControlFrame?("restore-\(project.id)", $0)
            }
            Button("Excluir…") { confirmDeletion([project]) }
                .buttonStyle(.appSecondary)
                .help("Excluir definitivamente")
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("projects-trash")) } action: {
                    onControlFrame?("delete-\(project.id)", $0)
                }
        }
        .fixedSize()
    }

    private func confirmDeletion(_ projects: [ProjectFolder]) {
        pendingDeletion = projects
        confirmingDeletion = true
    }
}
