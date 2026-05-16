// root/static/js/user-manager.core.js

class UserManager {
    constructor(config) {
        this.apiType = config.apiType;
        this.tableBody = document.getElementById("usersTableBody");
        this.role = config.currentRole || this.getCurrentUserRole();
        this.mode = "create";
        this.currentEditId = null;
        
        // Property for transport units
        this.transportUnits = [];
        
        this.init();
    }

    getCurrentUserRole() {
        const meta = document.querySelector('meta[name="user-role"]');
        return meta ? meta.getAttribute("content") : null;
    }

    // Helper function to get CSRF token from cookie
    getCsrfToken() {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'XSRF-TOKEN') {
                return decodeURIComponent(value);
            }
        }
        return null;
    }

    // Helper function for API requests with CSRF token
    async apiRequest(url, options = {}) {
        const method = options.method || 'GET';
        const csrfToken = this.getCsrfToken();
        
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        // Add CSRF token for non-GET requests
        if (method !== 'GET' && csrfToken) {
            headers['X-CSRFToken'] = csrfToken;
        }
        
        const config = {
            ...options,
            method,
            headers,
            credentials: 'include'  // Important for cookies
        };
        
        // Don't set body for GET requests
        if (method === 'GET' && config.body) {
            delete config.body;
        }
        
        return fetch(url, config);
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
        try {
            const res = await this.apiRequest(`/api/users/${this.apiType}`);
            if (!res.ok) {
                throw new Error("Failed to load users");
            }
            const data = await res.json();
            this.render(data.users || []);
        } catch (error) {
            console.error("Error loading users:", error);
            window.toastError("Failed to load users. Please refresh the page.");
        }
    }

    render(users) {
        this.tableBody.innerHTML = users.map(u => `
            <tr>
                <td>${this.escapeHtml(u.fullName)}</td>
                <td>${this.escapeHtml(u.email)}</td>
                <td>${this.escapeHtml(u.role)}</td>
                <td>${u.createdAt || '-'}</td>
                <td>
                    ${this.canEdit()
                        ? `<button class="btn btn-edit" onclick="userManager.edit('${u.id}')">Edit</button>`
                        : ''}

                    ${this.canDelete()
                        ? `<button class="btn btn-delete" onclick="userManager.deleteUser('${u.id}')">Delete</button>`
                        : ''}
                 </td>
             </tr>
        `).join("");
    }

    escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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

    async openCreate() {
        if (!this.canCreate()) {
            window.toastError("You don't have permission to create users.", "Access Denied");
            return;
        }
        
        this.mode = "create";
        this.currentEditId = null;
        
        this.clear();
        document.getElementById("userModalTitle").innerText = `Create ${this.getUserTypeLabel()}`;
        
        this.configureRoleField();
        await this.toggleTransportUnitField();
        
        document.getElementById("userModal").style.display = "flex";
    }

    getUserTypeLabel() {
        switch(this.apiType) {
            case "driver": return "Driver";
            case "admin": return "Admin";
            case "customer": return "Customer";
            default: return "User";
        }
    }

    async edit(id) {
        this.mode = "update";
        this.currentEditId = id;
        
        try {
            const res = await this.apiRequest(`/api/user/${id}`);
            if (!res.ok) {
                throw new Error("Failed to load user");
            }
            
            const user = await res.json();
            
            document.getElementById("userId").value = user.id;
            document.getElementById("fullName").value = user.fullName || "";
            document.getElementById("email").value = user.email || "";
            
            this.configureRoleField(user.role);
            await this.toggleTransportUnitField();
            
            // If editing a driver, load their assigned transport unit
            if (this.apiType === "driver" && user.transportUnitId) {
                await this.loadTransportUnits();
                this.populateTransportUnitDropdown(user.transportUnitId);
            }
            
            document.getElementById("userModalTitle").innerText = `Update ${this.getUserTypeLabel()}`;
            document.getElementById("userModal").style.display = "flex";
        } catch (error) {
            console.error("Error loading user:", error);
            window.toastError("Failed to load user details.");
        }
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
        const fullName = document.getElementById("fullName").value.trim();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password")?.value;
        
        // Validation
        if (!fullName) {
            window.toastError("Please enter full name.");
            return;
        }
        
        if (!email) {
            window.toastError("Please enter email address.");
            return;
        }
        
        if (!email.includes('@')) {
            window.toastError("Please enter a valid email address.");
            return;
        }
        
        const payload = {
            fullName: fullName,
            email: email,
            role: document.getElementById("role").value,
            password: password || null
        };
        
        // Add transport unit for drivers
        if (this.apiType === "driver") {
            const transportUnitId = document.getElementById("transportUnitId")?.value;
            if (transportUnitId) {
                payload.transportUnitId = transportUnitId;
            }
        }
        
        const url = id ? `/api/user/update/${id}` : `/api/user/create`;
        const method = id ? "PUT" : "POST";
        
        try {
            const res = await this.apiRequest(url, {
                method,
                body: JSON.stringify(payload)
            });
            
            const data = await res.json();
            
            if (!res.ok) {
                throw new Error(data.error || "Failed to save user");
            }
            
            const action = id ? "updated" : "created";
            window.toastSuccess(`${this.getUserTypeLabel()} ${action} successfully!`);
            
            this.close();
            this.loadUsers();
        } catch (error) {
            console.error("Error saving user:", error);
            window.toastError(error.message || "Failed to save user.");
        }
    }

    async deleteUser(id) {
        if (!this.canDelete()) {
            window.toastError("You don't have permission to delete users.", "Access Denied");
            return;
        }
        
        // Get user name for the confirmation message
        let userName = "";
        try {
            const res = await this.apiRequest(`/api/user/${id}`);
            if (res.ok) {
                const user = await res.json();
                userName = user.fullName || "";
            }
        } catch (e) {
            // Continue with deletion even if we can't get the name
        }
        
        window.showConfirmModal({
            title: "Delete User",
            message: `Are you sure you want to delete ${userName ? userName : "this user"}? This action cannot be undone.`,
            confirmText: "Delete",
            confirmIcon: "fa-trash",
            type: "danger",
            onConfirm: async () => {
                try {
                    const res = await this.apiRequest(`/api/user/delete/${id}`, { 
                        method: "DELETE" 
                    });
                    const data = await res.json();
                    
                    if (!res.ok) {
                        throw new Error(data.error || "Failed to delete user");
                    }
                    
                    window.toastSuccess(`${this.getUserTypeLabel()} deleted successfully!`);
                    this.loadUsers();
                } catch (error) {
                    console.error("Error deleting user:", error);
                    window.toastError(error.message || "Failed to delete user.");
                }
            }
        });
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
        document.getElementById("password").value = "";
        
        const roleField = document.getElementById("role");
        if (roleField) roleField.value = "";
        
        // Clear transport unit dropdown
        const transportSelect = document.getElementById("transportUnitId");
        if (transportSelect) transportSelect.value = "";
    }

    async loadTransportUnits() {
        try {
            const res = await this.apiRequest('/api/common/transport-units');
            
            if (res.status === 404) {
                console.warn('Transport units API not available (404)');
                this.transportUnits = [];
                return [];
            }
            
            if (!res.ok) {
                console.error(`Failed to load transport units: ${res.status}`);
                this.transportUnits = [];
                return [];
            }
            
            const data = await res.json();
            const units = data.units || [];
            
            // Sort: first by transportUnit (ascending), then by plateNumber (ascending)
            units.sort((a, b) => {
                const unitCompare = (a.transportUnit || "").localeCompare(b.transportUnit || "");
                if (unitCompare !== 0) return unitCompare;
                return (a.plateNumber || "").localeCompare(b.plateNumber || "");
            });
            
            this.transportUnits = units;
            return units;
        } catch (error) {
            console.error("Failed to load transport units:", error);
            this.transportUnits = [];
            return [];
        }
    }

    populateTransportUnitDropdown(selectedId = null) {
        const select = document.getElementById("transportUnitId");
        if (!select) return;
        
        let options = '<option value="">-- Select Transport Unit --</option>';
        
        for (const unit of this.transportUnits) {
            const displayText = `${unit.transportUnit || 'Unknown'} - (${unit.plateNumber || 'N/A'}) || ${unit.unitType || 'Unknown'} ${!unit.isAvailable ? '[UNAVAILABLE]' : ''}`;
            const selected = selectedId === unit.id ? 'selected' : '';
            const disabled = !unit.isAvailable ? 'disabled style="color:#999;"' : '';
            options += `<option value="${unit.id}" ${selected} ${disabled}>${this.escapeHtml(displayText)}</option>`;
        }
        
        select.innerHTML = options;
    }

    async toggleTransportUnitField() {
        const group = document.getElementById("transportUnitGroup");
        if (!group) return;
        
        // Only show for drivers
        if (this.apiType === "driver") {
            group.style.display = "block";
            // Load transport units if not already loaded
            if (this.transportUnits.length === 0) {
                await this.loadTransportUnits();
                this.populateTransportUnitDropdown();
            } else {
                this.populateTransportUnitDropdown();
            }
        } else {
            group.style.display = "none";
        }
    }
}

// Global functions for modal buttons
function closeUserModal() {
    if (typeof userManager !== 'undefined' && userManager) {
        userManager.close();
    }
}

function submitUser() {
    if (typeof userManager !== 'undefined' && userManager) {
        userManager.save();
    }
}