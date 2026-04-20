// ============================================
// Change Password Functionality with Reusable Toast
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('changePasswordModal');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const changePasswordForm = document.getElementById('changePasswordForm');
    
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
                const response = await fetch('/api/v1/auth/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
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