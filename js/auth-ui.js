// Authentication UI Manager
// Handles login screen and character selection screen

class AuthUI {
    constructor() {
        this.loginContainer = null;
        this.characterSelectContainer = null;
        this.onLoginSuccess = null;
        this.onCharacterSelected = null;
    }
    
    // =============================================
    // LOGIN SCREEN
    // =============================================
    
    showLoginScreen(onSuccess) {
        this.onLoginSuccess = onSuccess;
        
        // Remove any existing containers
        this.hideAll();
        
        this.loginContainer = document.createElement('div');
        this.loginContainer.id = 'login-screen';
        this.loginContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100000;
            font-family: Arial, sans-serif;
        `;
        
        this.loginContainer.innerHTML = `
            <div style="
                background: rgba(0, 0, 0, 0.8);
                border: 3px solid #ffd700;
                border-radius: 15px;
                padding: 40px;
                min-width: 400px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.5);
            ">
                <h1 style="
                    color: #ffd700;
                    text-align: center;
                    margin: 0 0 10px 0;
                    font-size: 32px;
                    text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
                ">Heroes of Shady Grove</h1>
                
                <p style="color: #aaa; text-align: center; margin: 0 0 30px 0; font-size: 14px;">
                    Enter your username and password
                </p>
                
                <div id="login-error" style="
                    display: none;
                    background: rgba(255, 0, 0, 0.2);
                    border: 1px solid #ff4444;
                    color: #ff6666;
                    padding: 10px;
                    border-radius: 5px;
                    margin-bottom: 20px;
                    text-align: center;
                "></div>
                
                <div style="margin-bottom: 20px;">
                    <label style="color: #ffd700; display: block; margin-bottom: 5px; font-weight: bold;">
                        Username
                    </label>
                    <input 
                        type="text" 
                        id="username-input"
                        placeholder="Enter username (3+ characters)"
                        maxlength="20"
                        style="
                            width: 100%;
                            padding: 12px;
                            background: rgba(255, 255, 255, 0.1);
                            border: 2px solid #666;
                            border-radius: 5px;
                            color: white;
                            font-size: 16px;
                            box-sizing: border-box;
                        "
                    />
                </div>
                
                <div style="margin-bottom: 30px;">
                    <label style="color: #ffd700; display: block; margin-bottom: 5px; font-weight: bold;">
                        Password
                    </label>
                    <input 
                        type="password" 
                        id="password-input"
                        placeholder="Enter password"
                        maxlength="50"
                        style="
                            width: 100%;
                            padding: 12px;
                            background: rgba(255, 255, 255, 0.1);
                            border: 2px solid #666;
                            border-radius: 5px;
                            color: white;
                            font-size: 16px;
                            box-sizing: border-box;
                        "
                    />
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <button id="login-button" style="
                        flex: 1;
                        padding: 15px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        border: none;
                        border-radius: 5px;
                        color: white;
                        font-size: 16px;
                        font-weight: bold;
                        cursor: pointer;
                        transition: transform 0.2s;
                    ">
                        Login
                    </button>
                    
                    <button id="register-button" style="
                        flex: 1;
                        padding: 15px;
                        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                        border: none;
                        border-radius: 5px;
                        color: white;
                        font-size: 16px;
                        font-weight: bold;
                        cursor: pointer;
                        transition: transform 0.2s;
                    ">
                        Register
                    </button>
                </div>
                
                <p style="color: #888; text-align: center; margin: 20px 0 0 0; font-size: 12px;">
                    No email required • Username must be 3+ characters
                </p>
            </div>
        `;
        
        document.body.appendChild(this.loginContainer);
        
        // Add event listeners
        const usernameInput = document.getElementById('username-input');
        const passwordInput = document.getElementById('password-input');
        const loginButton = document.getElementById('login-button');
        const registerButton = document.getElementById('register-button');
        
        // Hover effects
        loginButton.addEventListener('mouseenter', () => loginButton.style.transform = 'scale(1.05)');
        loginButton.addEventListener('mouseleave', () => loginButton.style.transform = 'scale(1)');
        registerButton.addEventListener('mouseenter', () => registerButton.style.transform = 'scale(1.05)');
        registerButton.addEventListener('mouseleave', () => registerButton.style.transform = 'scale(1)');
        
        // Login action
        const attemptLogin = async () => {
            const username = usernameInput.value.trim();
            const password = passwordInput.value;
            
            if (!username || !password) {
                this.showError('Please enter username and password');
                return;
            }
            
            try {
                loginButton.disabled = true;
                registerButton.disabled = true;
                loginButton.textContent = 'Logging in...';
                
                await window.supabaseService.login(username, password);
                
                // Success - move to character select
                this.loginContainer.remove();
                if (this.onLoginSuccess) this.onLoginSuccess();
                
            } catch (error) {
                this.showError(error.message);
                loginButton.disabled = false;
                registerButton.disabled = false;
                loginButton.textContent = 'Login';
            }
        };
        
        // Register action
        const attemptRegister = async () => {
            const username = usernameInput.value.trim();
            const password = passwordInput.value;
            
            if (!username || username.length < 3) {
                this.showError('Username must be at least 3 characters');
                return;
            }
            
            if (!password || password.length < 3) {
                this.showError('Password must be at least 3 characters');
                return;
            }
            
            try {
                loginButton.disabled = true;
                registerButton.disabled = true;
                registerButton.textContent = 'Creating...';
                
                await window.supabaseService.register(username, password);
                
                // Success - move to character select
                this.loginContainer.remove();
                if (this.onLoginSuccess) this.onLoginSuccess();
                
            } catch (error) {
                this.showError(error.message);
                loginButton.disabled = false;
                registerButton.disabled = false;
                registerButton.textContent = 'Register';
            }
        };
        
        loginButton.addEventListener('click', attemptLogin);
        registerButton.addEventListener('click', attemptRegister);
        
        // Enter key submits
        usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') attemptLogin();
        });
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') attemptLogin();
        });
        
        // Focus username input
        setTimeout(() => usernameInput.focus(), 100);
    }
    
    showError(message) {
        const errorDiv = document.getElementById('login-error');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            setTimeout(() => {
                errorDiv.style.display = 'none';
            }, 5000);
        }
    }
    
    // =============================================
    // CHARACTER SELECT SCREEN
    // =============================================
    
    async showCharacterSelect(onCharacterSelected) {
        this.onCharacterSelected = onCharacterSelected;
        
        // Remove any existing containers
        this.hideAll();
        
        this.characterSelectContainer = document.createElement('div');
        this.characterSelectContainer.id = 'character-select-screen';
        this.characterSelectContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 100000;
            font-family: Arial, sans-serif;
            padding: 20px;
            box-sizing: border-box;
        `;
        
        this.characterSelectContainer.innerHTML = `
            <div style="
                background: rgba(0, 0, 0, 0.8);
                border: 3px solid #ffd700;
                border-radius: 15px;
                padding: 30px;
                max-width: 900px;
                width: 100%;
                box-shadow: 0 10px 40px rgba(0,0,0,0.5);
            ">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h1 style="
                        color: #ffd700;
                        margin: 0;
                        font-size: 28px;
                        text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
                    ">Select Character</h1>
                    
                    <div style="color: #aaa; font-size: 14px;">
                        <span id="account-name"></span>
                        <button id="logout-button" style="
                            margin-left: 15px;
                            padding: 8px 15px;
                            background: rgba(255, 0, 0, 0.3);
                            border: 1px solid #ff4444;
                            border-radius: 5px;
                            color: white;
                            cursor: pointer;
                            font-size: 12px;
                        ">Logout</button>
                    </div>
                </div>
                
                <div id="char-error" style="
                    display: none;
                    background: rgba(255, 0, 0, 0.2);
                    border: 1px solid #ff4444;
                    color: #ff6666;
                    padding: 10px;
                    border-radius: 5px;
                    margin-bottom: 15px;
                    text-align: center;
                "></div>
                
                <div id="characters-list" style="
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                    gap: 15px;
                    margin-bottom: 20px;
                    max-height: 400px;
                    overflow-y: auto;
                    padding: 10px;
                "></div>
                
                <div style="display: flex; gap: 10px; border-top: 2px solid #666; padding-top: 20px;">
                    <button id="create-char-button" style="
                        flex: 1;
                        padding: 15px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        border: none;
                        border-radius: 5px;
                        color: white;
                        font-size: 16px;
                        font-weight: bold;
                        cursor: pointer;
                        transition: transform 0.2s;
                    ">
                        + Create New Character
                    </button>
                    
                    <button id="enter-world-button" style="
                        flex: 1;
                        padding: 15px;
                        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                        border: none;
                        border-radius: 5px;
                        color: white;
                        font-size: 16px;
                        font-weight: bold;
                        cursor: pointer;
                        transition: transform 0.2s;
                        opacity: 0.5;
                    " disabled>
                        Enter World
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.characterSelectContainer);
        
        // Set account name
        document.getElementById('account-name').textContent = 
            `Account: ${window.supabaseService.currentAccount.username}`;
        
        // Load characters
        await this.loadCharactersList();
        
        // Event listeners
        const createButton = document.getElementById('create-char-button');
        const enterButton = document.getElementById('enter-world-button');
        const logoutButton = document.getElementById('logout-button');
        
        createButton.addEventListener('mouseenter', () => createButton.style.transform = 'scale(1.05)');
        createButton.addEventListener('mouseleave', () => createButton.style.transform = 'scale(1)');
        enterButton.addEventListener('mouseenter', () => {
            if (!enterButton.disabled) enterButton.style.transform = 'scale(1.05)';
        });
        enterButton.addEventListener('mouseleave', () => enterButton.style.transform = 'scale(1)');
        
        createButton.addEventListener('click', () => this.showCreateCharacterDialog());
        enterButton.addEventListener('click', async () => {
            if (this.selectedCharacterId) {
                try {
                    const character = await window.supabaseService.selectCharacter(this.selectedCharacterId);
                    this.characterSelectContainer.remove();
                    if (this.onCharacterSelected) this.onCharacterSelected(character);
                } catch (error) {
                    this.showCharError(error.message);
                }
            }
        });
        
        logoutButton.addEventListener('click', async () => {
            await window.supabaseService.logout();
            location.reload(); // Reload page to restart
        });
    }
    
    async loadCharactersList() {
        const listContainer = document.getElementById('characters-list');
        if (!listContainer) return;
        
        try {
            const characters = await window.supabaseService.getCharacters();
            
            listContainer.innerHTML = '';
            this.selectedCharacterId = null;
            
            if (characters.length === 0) {
                listContainer.innerHTML = `
                    <div style="
                        grid-column: 1 / -1;
                        text-align: center;
                        padding: 40px;
                        color: #aaa;
                    ">
                        <p style="font-size: 18px; margin: 0;">No characters yet</p>
                        <p style="font-size: 14px; margin: 10px 0 0 0;">Click "Create New Character" to get started</p>
                    </div>
                `;
                return;
            }
            
            characters.forEach(char => {
                const charCard = document.createElement('div');
                charCard.className = 'character-card';
                charCard.dataset.id = char.id;
                charCard.style.cssText = `
                    background: rgba(255, 255, 255, 0.05);
                    border: 2px solid #666;
                    border-radius: 10px;
                    padding: 15px;
                    cursor: pointer;
                    transition: all 0.2s;
                    position: relative;
                `;
                
                charCard.innerHTML = `
                    <div style="color: #ffd700; font-size: 18px; font-weight: bold; margin-bottom: 10px;">
                        ${char.name}
                    </div>
                    <div style="color: #aaa; font-size: 14px;">
                        Level ${char.level}
                    </div>
                    <div style="color: #888; font-size: 12px; margin-top: 5px;">
                        HP: ${Math.round(char.health)}/${Math.round(char.health)}
                    </div>
                    <button class="delete-char-btn" data-id="${char.id}" style="
                        position: absolute;
                        top: 5px;
                        right: 5px;
                        background: rgba(255, 0, 0, 0.3);
                        border: 1px solid #ff4444;
                        border-radius: 3px;
                        color: white;
                        padding: 3px 8px;
                        font-size: 11px;
                        cursor: pointer;
                    ">Delete</button>
                `;
                
                charCard.addEventListener('click', (e) => {
                    if (e.target.classList.contains('delete-char-btn')) return;
                    this.selectCharacter(char.id);
                });
                
                charCard.addEventListener('mouseenter', () => {
                    if (charCard.dataset.id !== this.selectedCharacterId) {
                        charCard.style.borderColor = '#888';
                        charCard.style.transform = 'translateY(-3px)';
                    }
                });
                
                charCard.addEventListener('mouseleave', () => {
                    if (charCard.dataset.id !== this.selectedCharacterId) {
                        charCard.style.borderColor = '#666';
                        charCard.style.transform = 'translateY(0)';
                    }
                });
                
                const deleteBtn = charCard.querySelector('.delete-char-btn');
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete character "${char.name}"? This cannot be undone!`)) {
                        try {
                            await window.supabaseService.deleteCharacter(char.id);
                            await this.loadCharactersList();
                        } catch (error) {
                            this.showCharError(error.message);
                        }
                    }
                });
                
                listContainer.appendChild(charCard);
            });
            
        } catch (error) {
            console.error('[AuthUI] Failed to load characters:', error);
            listContainer.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #ff6666;">
                    Failed to load characters: ${error.message}
                </div>
            `;
        }
    }
    
    selectCharacter(characterId) {
        // Update selection
        const cards = document.querySelectorAll('.character-card');
        cards.forEach(card => {
            if (card.dataset.id === characterId) {
                card.style.borderColor = '#ffd700';
                card.style.borderWidth = '3px';
                card.style.background = 'rgba(255, 215, 0, 0.1)';
            } else {
                card.style.borderColor = '#666';
                card.style.borderWidth = '2px';
                card.style.background = 'rgba(255, 255, 255, 0.05)';
            }
        });
        
        this.selectedCharacterId = characterId;
        
        // Enable enter world button
        const enterButton = document.getElementById('enter-world-button');
        enterButton.disabled = false;
        enterButton.style.opacity = '1';
    }
    
    showCreateCharacterDialog() {
        const name = prompt('Enter character name (3-20 characters, letters/numbers only):');
        if (!name) return;
        
        const trimmedName = name.trim();
        
        if (trimmedName.length < 3 || trimmedName.length > 20) {
            alert('Character name must be 3-20 characters');
            return;
        }
        
        if (!/^[a-zA-Z0-9]+$/.test(trimmedName)) {
            alert('Character name can only contain letters and numbers');
            return;
        }
        
        this.createCharacter(trimmedName);
    }
    
    async createCharacter(name) {
        try {
            await window.supabaseService.createCharacter(name);
            await this.loadCharactersList();
        } catch (error) {
            alert(error.message);
        }
    }
    
    showCharError(message) {
        const errorDiv = document.getElementById('char-error');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            setTimeout(() => {
                errorDiv.style.display = 'none';
            }, 5000);
        }
    }
    
    // =============================================
    // UTILITIES
    // =============================================
    
    hideAll() {
        if (this.loginContainer) {
            this.loginContainer.remove();
            this.loginContainer = null;
        }
        if (this.characterSelectContainer) {
            this.characterSelectContainer.remove();
            this.characterSelectContainer = null;
        }
    }
}

// Create global instance
window.authUI = new AuthUI();
console.log('[AuthUI] UI initialized');
