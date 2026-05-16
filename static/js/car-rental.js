// car-rental.js - Main controller with CSRF support
(function() {
    'use strict';
    
    let sessionRole = null;
    
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
        
        const defaultHeaders = {
            'Content-Type': 'application/json',
        };
        
        // Add CSRF token for non-GET requests
        if (method !== 'GET' && csrfToken) {
            defaultHeaders['X-CSRFToken'] = csrfToken;
        }
        
        const config = {
            ...options,
            method,
            headers: {
                ...defaultHeaders,
                ...options.headers
            },
            credentials: 'include'  // Important for cookies
        };
        
        return fetch(url, config);
    }
    
    // Global notification function that both modules can use
    window.showNotificationGlobal = function(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    };
    
    // Get session role (now uses apiRequest)
    window.getSessionRole = function() {
        return sessionRole;
    };
    
    // Global CSRF token getter for other modules to use
    window.getCsrfToken = getCsrfToken;
    
    // Global API request helper for other modules to use
    window.apiRequest = apiRequest;
    
    // ========== TAB SWITCHING ==========
    function initializeTabs() {
        const selfDriveTab = document.querySelector('.rental-type[data-type="self-drive"]');
        const withDriverTab = document.querySelector('.rental-type[data-type="with-driver"]');
        const selfDriveContent = document.getElementById('selfDriveContent');
        const withDriverContent = document.getElementById('withDriverContent');
        
        if (!selfDriveTab || !withDriverTab) return;
        
        selfDriveTab.addEventListener('click', async () => {
            // Update tab styles
            selfDriveTab.classList.add('active');
            withDriverTab.classList.remove('active');
            
            // Show/hide content
            selfDriveContent.classList.add('active');
            withDriverContent.classList.remove('active');
            
            // Refresh Self-Drive data when switching back
            if (window.selfDrive && typeof window.selfDrive.refresh === 'function') {
                await window.selfDrive.refresh();
            }
        });
        
        withDriverTab.addEventListener('click', async () => {
            // Update tab styles
            withDriverTab.classList.add('active');
            selfDriveTab.classList.remove('active');
            
            // Show/hide content
            withDriverContent.classList.add('active');
            selfDriveContent.classList.remove('active');
            
            // Initialize With Driver when first opened
            if (window.withDriver && typeof window.withDriver.initialize === 'function') {
                await window.withDriver.initialize();
            } else {
                window.showNotificationGlobal('With Driver feature coming soon!', 'info');
            }
        });
    }
    
    // ========== INITIALIZE ==========
    async function initialize() {
        const roleElement = document.querySelector('meta[name="user-role"]');
        sessionRole = roleElement ? roleElement.content : 'admin';
        
        // Get session role from backend if meta tag not available or for verification
        if (!sessionRole || sessionRole === 'admin') {
            try {
                const response = await apiRequest('/api/v1/auth/session/check');
                const data = await response.json();
                if (data.authenticated && data.user && data.user.role) {
                    sessionRole = data.user.role;
                    console.log('Session role fetched:', sessionRole);
                }
            } catch (error) {
                console.error('Error fetching session role:', error);
            }
        }
        
        // Initialize Self-Drive (always loaded first)
        if (window.selfDrive && typeof window.selfDrive.initialize === 'function') {
            await window.selfDrive.initialize();
        } else {
            console.error('Self-Drive module not loaded');
            window.showNotificationGlobal('Error loading Self-Drive module', 'error');
        }
        
        initializeTabs();
    }
    
    // Start the app
    document.addEventListener('DOMContentLoaded', initialize);
})();