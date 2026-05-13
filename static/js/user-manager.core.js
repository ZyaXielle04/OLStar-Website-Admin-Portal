class UserManager {
    constructor(config) {
        this.apiType = config.apiType;
        this.tableBody = document.getElementById("usersTableBody");

        this.role = config.currentRole || this.getCurrentUserRole();

        this.mode = "create";
        this.currentEditId = null;

        this.init();
    }

    getCurrentUserRole() {
        const meta = document.querySelector('meta[name="user-role"]');
        return meta ? meta.getAttribute("content") : null;
    }

    init() {
        this.loadUsers();
        this.bindEvents();
    }

    bindEvents() {
        const btn = document.getElementById("addUserBtn");
        if (btn) btn.addEventListener("click", () => this.openCreate());
    }

    async loadUsers() {
        const res = await fetch(`/api/users/${this.apiType}`);
        if (!res.ok) return;

        const data = await res.json();
        this.render(data.users || []);
    }

    render(users) {
        this.tableBody.innerHTML = users.map(u => `
            <tr>
                <td>${u.fullName}</td>
                <td>${u.email}</td>
                <td>${u.role}</td>
                <td>${u.createdAt || '-'}</td>
                <td>
                    ${this.canEdit()
                        ? `<button class="btn btn-edit" onclick="userManager.edit('${u.id}')">Edit</button>`
                        : ''}

                    ${this.canDelete()
                        ? `<button class="btn btn-delete" onclick="userManager.remove('${u.id}')">Delete</button>`
                        : ''}
                </td>
            </tr>
        `).join("");
    }

    canCreate() {
        if (this.apiType === "admin") return this.role === "superadmin";
        if (this.apiType === "customer") return false;
        if (this.apiType === "driver") return ["admin", "superadmin"].includes(this.role);
        return false;
    }

    canEdit() {
        return ["admin", "superadmin"].includes(this.role);
    }

    canDelete() {
        if (this.apiType === "admin") return this.role === "superadmin";
        if (this.apiType === "customer") return this.role === "superadmin";
        if (this.apiType === "driver") return ["admin", "superadmin"].includes(this.role);
        return false;
    }

    openCreate() {
        if (!this.canCreate()) return alert("Access denied");

        this.mode = "create";
        this.currentEditId = null;

        this.clear();
        document.getElementById("userModalTitle").innerText = "Create User";

        this.configureRoleField();

        document.getElementById("userModal").style.display = "flex";
    }

    async edit(id) {
        this.mode = "update";
        this.currentEditId = id;

        const res = await fetch(`/api/user/${id}`);
        if (!res.ok) return alert("Failed load user");

        const user = await res.json();

        document.getElementById("userId").value = user.id;
        document.getElementById("fullName").value = user.fullName || "";
        document.getElementById("email").value = user.email || "";

        this.configureRoleField(user.role);

        document.getElementById("userModalTitle").innerText = "Update User";
        document.getElementById("userModal").style.display = "flex";
    }

    configureRoleField(existingRole = null) {
        const roleField = document.getElementById("role");
        const group = roleField.closest(".form-group");

        if (this.apiType === "admin") {
            group.style.display = "block";
            roleField.innerHTML = `
                <option value="admin">Admin</option>
                <option value="superadmin">Superadmin</option>
            `;
        }

        if (this.apiType === "customer") {
            group.style.display = "none";
            roleField.value = "customer";
        }

        if (this.apiType === "driver") {
            group.style.display = "none";
            roleField.value = "driver";
        }

        if (existingRole) roleField.value = existingRole;
    }

    async save() {
        const id = document.getElementById("userId").value;

        const payload = {
            fullName: document.getElementById("fullName").value,
            email: document.getElementById("email").value,
            role: document.getElementById("role").value,
            password: document.getElementById("password")?.value || null
        };

        const url = id ? `/api/user/update/${id}` : `/api/user/create`;
        const method = id ? "PUT" : "POST";

        await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        this.close();
        this.loadUsers();
    }

    async remove(id) {
        if (!confirm("Delete user?")) return;

        await fetch(`/api/user/delete/${id}`, { method: "DELETE" });
        this.loadUsers();
    }

    close() {
        document.getElementById("userModal").style.display = "none";
        this.mode = "create";
        this.currentEditId = null;
        document.getElementById("userModalTitle").innerText = "Create User";
        this.clear();
    }

    clear() {
        document.getElementById("userId").value = "";
        document.getElementById("fullName").value = "";
        document.getElementById("email").value = "";

        const roleField = document.getElementById("role");
        if (roleField) roleField.value = "";
    }
}

function closeUserModal() {
    userManager.close();
}

function submitUser() {
    userManager.save();
}