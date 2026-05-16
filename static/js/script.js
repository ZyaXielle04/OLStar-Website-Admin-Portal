// Management Portal | Production-Ready Authentication with CSRF Support
(function() {
  'use strict';

  // DOM Elements
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError = document.getElementById('emailError');
  const passwordError = document.getElementById('passwordError');
  const loginBtn = document.getElementById('loginBtn');
  const rememberCheckbox = document.getElementById('rememberMe');
  const forgotLink = document.getElementById('forgotPasswordLink');
  const passwordToggle = document.getElementById('passwordToggle');
  
  // Get CSRF token from cookie (consistent with other modules)
  const getCsrfToken = () => {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'XSRF-TOKEN') {
        return decodeURIComponent(value);
      }
    }
    return null;
  };

  let isSubmitting = false;

  // Utility Functions
  const sanitizeInput = (value) => value.trim().toLowerCase();
  
  const isValidEmail = (email) => {
    if (!email) return false;
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
  };
  
  const isValidPassword = (password) => {
    if (!password) return false;
    const trimmed = password.trim();
    return trimmed.length >= 8 && trimmed.length <= 128;
  };

  // Error Handling
  const setError = (inputElement, errorContainer, message) => {
    if (!errorContainer) return;
    
    if (message) {
      errorContainer.textContent = message;
      errorContainer.setAttribute('aria-live', 'polite');
      if (inputElement) {
        inputElement.setAttribute('aria-invalid', 'true');
        inputElement.style.borderColor = '#dc2626';
        inputElement.style.backgroundColor = '#fef2f2';
      }
    } else {
      errorContainer.textContent = '';
      errorContainer.removeAttribute('aria-live');
      if (inputElement) {
        inputElement.removeAttribute('aria-invalid');
        inputElement.style.borderColor = '';
        inputElement.style.backgroundColor = '';
      }
    }
  };

  const clearFieldErrorStyle = (inputField) => {
    if (inputField) {
      inputField.removeAttribute('aria-invalid');
      inputField.style.borderColor = '';
      inputField.style.backgroundColor = '';
    }
  };

  // Validation Functions
  const validateEmailField = () => {
    const emailValue = sanitizeInput(emailInput.value);
    
    if (emailValue === '') {
      setError(emailInput, emailError, 'Email address is required');
      return false;
    } else if (!isValidEmail(emailValue)) {
      setError(emailInput, emailError, 'Enter a valid email address (e.g., name@company.com)');
      return false;
    } else {
      setError(emailInput, emailError, '');
      clearFieldErrorStyle(emailInput);
      return true;
    }
  };

  const validatePasswordField = () => {
    const passwordValue = passwordInput.value;
    
    if (passwordValue === '') {
      setError(passwordInput, passwordError, 'Password is required');
      return false;
    } else if (!isValidPassword(passwordValue)) {
      setError(passwordInput, passwordError, 'Password must be at least 8 characters');
      return false;
    } else {
      setError(passwordInput, passwordError, '');
      clearFieldErrorStyle(passwordInput);
      return true;
    }
  };

  // Remember Me Functionality
  const saveRememberMe = (email) => {
    if (rememberCheckbox.checked) {
      try {
        localStorage.setItem('portal_remembered_email', email);
        localStorage.setItem('portal_remember_enabled', 'true');
      } catch (e) {
        console.error('Storage error:', e);
      }
    } else {
      try {
        localStorage.removeItem('portal_remembered_email');
        localStorage.setItem('portal_remember_enabled', 'false');
      } catch (e) {
        console.error('Storage error:', e);
      }
    }
  };

  const loadRememberedEmail = () => {
    try {
      const rememberEnabled = localStorage.getItem('portal_remember_enabled');
      if (rememberEnabled === 'true') {
        const savedEmail = localStorage.getItem('portal_remembered_email');
        if (savedEmail) {
          emailInput.value = savedEmail;
          rememberCheckbox.checked = true;
          validateEmailField();
        }
      }
    } catch (e) {
      console.error('Failed to load saved email:', e);
    }
  };

  // UI State Management
  const setFormLoading = (loading) => {
    isSubmitting = loading;
    loginBtn.disabled = loading;
    
    const btnText = loginBtn.querySelector('.btn-text');
    const btnLoader = loginBtn.querySelector('.btn-loader');
    
    if (loading) {
      const originalText = btnText.textContent;
      loginBtn.setAttribute('data-original-text', originalText);
      btnText.textContent = 'authenticating';
      btnLoader.style.display = 'inline-block';
    } else {
      const originalText = loginBtn.getAttribute('data-original-text');
      if (originalText) {
        btnText.textContent = originalText;
      }
      btnLoader.style.display = 'none';
      loginBtn.removeAttribute('data-original-text');
    }
  };

  const showToastMessage = (message, isError = true) => {
    const existingToast = document.querySelector('.portal-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'portal-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background-color: ${isError ? '#dc2626' : '#10b981'};
      color: white;
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 0.875rem;
      font-weight: 500;
      box-shadow: 0 8px 20px rgba(0,0,0,0.15);
      z-index: 1000;
      font-family: system-ui, sans-serif;
      text-align: center;
      max-width: 90%;
      white-space: nowrap;
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  };

  const shakeCard = () => {
    const card = document.querySelector('.login-card');
    card.style.transform = 'translateX(3px)';
    setTimeout(() => { card.style.transform = ''; }, 80);
    setTimeout(() => { if(card) card.style.transform = ''; }, 150);
  };

  // API Call with CSRF token from cookie
  const authenticateUser = async (email, password) => {
    const apiUrl = '/api/v1/auth/login';
    const csrfToken = getCsrfToken();
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    
    // Add CSRF token if available
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken;
    }
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ email, password }),
      credentials: 'include'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Authentication failed (${response.status})`);
    }

    return await response.json();
  };

  const handleLoginSuccess = (data) => {
    if (data.sessionToken) {
      sessionStorage.setItem('auth_token', data.sessionToken);
    }
    
    const redirectUrl = new URLSearchParams(window.location.search).get('redirect') || '/dashboard';
    window.location.href = redirectUrl;
  };

  // Main Login Handler
  const handleLogin = async (event) => {
    event.preventDefault();
    
    if (isSubmitting) return;
    
    const isEmailValid = validateEmailField();
    const isPasswordValid = validatePasswordField();
    
    if (!isEmailValid || !isPasswordValid) {
      shakeCard();
      return;
    }
    
    const email = sanitizeInput(emailInput.value);
    const password = passwordInput.value;
    
    saveRememberMe(email);
    setFormLoading(true);
    
    try {
      const response = await authenticateUser(email, password);
      handleLoginSuccess(response);
    } catch (error) {
        console.error('Login error:', error);
        
        let errorMessage = 'Unable to sign in. Please try again.';
        
        // Check for deactivation message specifically
        if (error.message.includes('deactivated')) {
            errorMessage = 'Your account has been deactivated. Please contact your portal administrator for assistance.';
        } else if (error.message.includes('401')) {
            errorMessage = 'Invalid email or password.';
        } else if (error.message.includes('403')) {
            errorMessage = 'Your account is not authorized. Please contact your system administrator.';
        } else if (error.message.includes('429')) {
            errorMessage = 'Too many failed attempts. Please try again later.';
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
            errorMessage = 'Network error. Please check your connection and try again.';
        } else if (error.message.includes('disabled')) {
            errorMessage = 'Your account has been disabled. Please contact your portal administrator.';
        }
        
        showToastMessage(errorMessage, true);
        passwordInput.value = '';
        emailInput.focus();
    } finally {
      setFormLoading(false);
    }
  };

  // Password Toggle Functionality
  const togglePasswordVisibility = () => {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    
    const eyeIcon = passwordToggle.querySelector('.eye-icon');
    if (type === 'text') {
      eyeIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
      eyeIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
  };

  const handleForgotPassword = (event) => {
    event.preventDefault();
    showToastMessage('Please contact your system administrator to reset your password.', false);
  };

  // Debounced Validation
  let validationTimeout;
  
  const debouncedValidate = (field) => {
    clearTimeout(validationTimeout);
    validationTimeout = setTimeout(() => {
      if (field === 'email') {
        validateEmailField();
      } else if (field === 'password') {
        validatePasswordField();
      }
    }, 300);
  };
  
  // Event Listeners
  emailInput.addEventListener('blur', () => validateEmailField());
  emailInput.addEventListener('input', () => {
    if (emailError.textContent !== '') {
      debouncedValidate('email');
    } else if (emailInput.value.trim() !== '' && isValidEmail(emailInput.value.trim())) {
      clearFieldErrorStyle(emailInput);
    }
  });
  
  passwordInput.addEventListener('blur', () => validatePasswordField());
  passwordInput.addEventListener('input', () => {
    if (passwordError.textContent !== '') {
      debouncedValidate('password');
    } else if (passwordInput.value.trim() !== '') {
      clearFieldErrorStyle(passwordInput);
    }
  });
  
  form.addEventListener('submit', handleLogin);
  forgotLink.addEventListener('click', handleForgotPassword);
  if (passwordToggle) {
    passwordToggle.addEventListener('click', togglePasswordVisibility);
  }
  
  // Initialize
  loadRememberedEmail();
  
  // Security: Clear password field on page unload
  window.addEventListener('beforeunload', () => {
    if (passwordInput) {
      passwordInput.value = '';
    }
  });
})();