// ============================================
// Change Password Functionality with Reusable Toast and CSRF Support
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('changePasswordModal');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const changePasswordForm = document.getElementById('changePasswordForm');
    
    // Helper function to get CSRF token from cookie
    function getCsrfToken() {
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
    async function apiRequest(url, options = {}) {
        const method = options.method || 'GET';
        const csrfToken = getCsrfToken();
        
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
        
        return fetch(url, config);
    }
    
    // Open modal
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', function() {
            modal.style.display = 'flex';
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
        });
    }
    
    // Close modal functions
    function closeModal() {
        modal.style.display = 'none';
    }
    
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
    }
    
    if (cancelModalBtn) {
        cancelModalBtn.addEventListener('click', closeModal);
    }
    
    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
        if (event.target === modal) {
            closeModal();
        }
    });
    
    // Handle form submission
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            // Validation
            if (newPassword !== confirmPassword) {
                toastError('New passwords do not match', 'Validation Error');
                return;
            }
            
            if (newPassword.length < 8) {
                toastError('New password must be at least 8 characters', 'Validation Error');
                return;
            }
            
            if (currentPassword === newPassword) {
                toastError('New password must be different from current password', 'Validation Error');
                return;
            }
            
            // Disable submit button while processing
            const submitBtn = changePasswordForm.querySelector('#submitPasswordBtn');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
            
            try {
                // Use apiRequest instead of fetch
                const response = await apiRequest('/api/v1/auth/change-password', {
                    method: 'POST',
                    body: JSON.stringify({
                        oldPassword: currentPassword,
                        newPassword: newPassword
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    toastSuccess('Your password has been changed successfully', 'Password Updated!');
                    setTimeout(() => {
                        closeModal();
                    }, 2000);
                } else {
                    toastError(data.message || 'Failed to change password', 'Error');
                }
            } catch (error) {
                console.error('Error changing password:', error);
                toastError('An unexpected error occurred. Please try again.', 'Connection Error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        });
    }
});