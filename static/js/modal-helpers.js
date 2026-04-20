// static/js/modal-helpers.js

// Delete confirmation helper
window.confirmDelete = function(itemName, onConfirm) {
    showConfirmModal({
        title: 'Delete Confirmation',
        message: `Are you sure you want to delete "${itemName}"? This action cannot be undone.`,
        confirmText: 'Delete',
        confirmIcon: 'fa-trash',
        cancelText: 'Cancel',
        type: 'danger',
        onConfirm: onConfirm
    });
};

// Warning confirmation helper
window.confirmWarning = function(title, message, onConfirm) {
    showConfirmModal({
        title: title,
        message: message,
        confirmText: 'Proceed',
        confirmIcon: 'fa-exclamation-triangle',
        cancelText: 'Cancel',
        type: 'warning',
        onConfirm: onConfirm
    });
};

// Success confirmation helper
window.confirmSuccess = function(title, message, onConfirm) {
    showConfirmModal({
        title: title,
        message: message,
        confirmText: 'Continue',
        confirmIcon: 'fa-check-circle',
        cancelText: 'Cancel',
        type: 'success',
        onConfirm: onConfirm
    });
};

// Info modal helper
window.showInfo = function(title, message, onConfirm) {
    showConfirmModal({
        title: title,
        message: message,
        confirmText: 'OK',
        confirmIcon: 'fa-info-circle',
        cancelText: 'Cancel',
        type: 'info',
        onConfirm: onConfirm || (() => {})
    });
};