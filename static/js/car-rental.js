// car-rental.js - Main controller
(function() {
    'use strict';
    
    let sessionRole = null;
    
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
    
    // Get session role
    window.getSessionRole = function() {
        return sessionRole;
    };
    
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