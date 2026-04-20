// Dashboard shared functionality
(function() {
    'use strict';
    
    // ===============================
    // HAMBURGER MENU (Mobile)
    // ===============================
    const hamburger = document.getElementById('hamburgerBtn');
    const sidebar = document.getElementById('sidebar');
    
    if (hamburger && sidebar) {
        hamburger.addEventListener('click', function() {
            sidebar.classList.toggle('open');
        });
        
        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', function(e) {
            if (window.innerWidth <= 768) {
                if (!sidebar.contains(e.target) && !hamburger.contains(e.target)) {
                    sidebar.classList.remove('open');
                }
            }
        });
    }
    
    // ===============================
    // ACTIVE NAV LINK HIGHLIGHTING
    // ===============================
    const currentPath = window.location.pathname;
    
    document.querySelectorAll('.nav-link').forEach(link => {
        const href = link.getAttribute('href');
        if (href && href === currentPath) {
            link.classList.add('active');
        }
    });
    
    // ===============================
    // LOGOUT FUNCTIONALITY
    // ===============================
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Show confirmation modal before logout
            showConfirmModal({
                title: 'Sign Out',
                message: 'Are you sure you want to sign out? You will need to log in again to access your account.',
                confirmText: 'Sign Out',
                confirmIcon: 'fa-sign-out-alt',
                cancelText: 'Cancel',
                type: 'warning',
                onConfirm: async () => {
                    // Show loading toast
                    toastInfo('Signing out...', 'Please wait');
                    
                    try {
                        const response = await fetch('/api/v1/auth/logout', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (response.ok) {
                            toastSuccess('Signed out successfully', 'Goodbye!');
                            setTimeout(() => {
                                window.location.href = '/login';
                            }, 1000);
                        } else {
                            toastError('Failed to sign out', 'Error');
                        }
                    } catch (error) {
                        console.error('Logout error:', error);
                        toastError('An error occurred while signing out', 'Error');
                    }
                }
            });
        });
    }
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            if (sidebar) {
                sidebar.classList.remove('open');
            }
        }
    });
})();