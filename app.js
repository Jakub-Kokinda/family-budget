// app.js
import { GoogleGenerativeAI } from 'https://esm.run/@google/generative-ai';
import Dexie from 'https://unpkg.com/dexie@4.0.8/dist/modern/dexie.mjs';

// Setup IndexedDB
const db = new Dexie("FamilyBudgetDB");
db.version(1).stores({
    expenses: 'id, type, amount, category, note, date, recurring'
});
db.version(2).stores({
    expenses: 'id, type, amount, category, note, date, recurring',
    budgets: 'category, limit'
});
db.version(3).stores({
    expenses: 'id, type, amount, category, note, date, recurring',
    budgets: 'category, limit',
    accounts: 'id, name, type, balance'
});
db.version(4).stores({
    expenses: 'id, type, amount, category, note, date, recurring',
    budgets: 'category, limit',
    accounts: 'id, name, type, balance',
    goals: 'id, name, targetAmount, currentAmount'
});

// State Management
let expenses = [];
let accounts = [];
let goals = [];
let categoryBudgets = {
    'Groceries': 500,
    'Housing': 1200,
    'Transport': 300,
    'Fun': 200,
    'Utilities': 150
};
let stream = null;

// Chart Instances
let expenseChartInstance = null;
let cashflowChartInstance = null;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    await loadData();
    await processRecurringTransactions();
    renderDashboard();
    initSettingsForm();
    initManualForm();
    initBudgetForm();
    initAccountForm();
    initGoalForm();
});

// Navigation
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');

    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Update buttons
            navBtns.forEach(b => b.classList.remove('active'));
            const targetBtn = e.target.closest('.nav-btn');
            targetBtn.classList.add('active');

            // Find target view
            const targetViewId = targetBtn.getAttribute('data-target');
            
            // Handle camera state based on view
            if (targetViewId === 'view-scan') {
                startCamera();
            } else {
                stopCamera();
            }

            // Update views
            views.forEach(v => {
                v.classList.remove('active-view');
                if (v.id === targetViewId) {
                    v.classList.add('active-view');
                    v.style.animation = 'fadeSlideUp 0.3s ease forwards';
                }
            });
        });
    });
}

// Camera & OCR Logic
async function startCamera() {
    const video = document.getElementById('camera-stream');
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' },
            audio: false 
        });
        video.srcObject = stream;
        
        document.getElementById('capture-btn').addEventListener('click', captureImage, {once: true});
    } catch (err) {
        console.error('Error accessing camera', err);
        alert('Could not access camera. Please check permissions.');
    }
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    // Reset scan results UI
    document.getElementById('scan-results').classList.add('hidden');
    document.getElementById('scanner-form').classList.add('hidden');
    document.getElementById('scanner-loading').classList.add('hidden');
    document.getElementById('scanned-image').style.display = 'none';
    document.getElementById('camera-stream').style.display = 'block';
}

async function captureImage() {
    const video = document.getElementById('camera-stream');
    const canvas = document.getElementById('camera-canvas');
    const img = document.getElementById('scanned-image');
    
    // Draw video frame to canvas
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    
    // Convert to target format
    const base64Img = canvas.toDataURL('image/jpeg', 0.8);
    img.src = base64Img;
    
    video.style.display = 'none';
    img.style.display = 'block';
    
    stopCamera(); // stop the stream

    // Open scanner result UI
    const scanResults = document.getElementById('scan-results');
    const loading = document.getElementById('scanner-loading');
    const form = document.getElementById('scanner-form');
    
    scanResults.classList.remove('hidden');
    loading.classList.remove('hidden');
    form.classList.add('hidden');

    // Run OCR with Gemini
    await analyzeReceiptWithGemini(base64Img);
}

async function analyzeReceiptWithGemini(base64Image) {
    const apiKey = localStorage.getItem('gemini_api_key');
    const loading = document.getElementById('scanner-loading');
    const form = document.getElementById('scanner-form');

    if (!apiKey) {
        alert('Please set your Gemini API key in Settings first.');
        loading.classList.add('hidden');
        form.classList.remove('hidden');
        return;
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // Convert data URL to correct format for API
        const base64Data = base64Image.split(',')[1];
        
        const prompt = `Analyze this receipt. Return ONLY a valid JSON object with these keys: 
        "amount" (number, total amount), 
        "category" (string, short category like 'Groceries' or 'Transport'), 
        "merchant" (string, name of the store).
        Do not include markdown blocks or any other text.`;

        const result = await model.generateContent([
            prompt,
            { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
        ]);

        const responseText = result.response.text().trim();
        const jsonStr = responseText.replace(/```json/g, '').replace(/```/g, '');
        const data = JSON.parse(jsonStr);

        document.getElementById('scan-amount').value = data.amount || '';
        document.getElementById('scan-category').value = data.category || '';
        document.getElementById('scan-note').value = data.merchant || '';
        
    } catch(err) {
        console.error('Gemini error:', err);
        alert('Failed to analyze image. Please fill details manually.');
    } finally {
        loading.classList.add('hidden');
        form.classList.remove('hidden');
        
        // Bind save button
        document.getElementById('save-scan-btn').onclick = async () => await saveScannedExpense();
    }
}

async function saveScannedExpense() {
    const amount = parseFloat(document.getElementById('scan-amount').value);
    const category = document.getElementById('scan-category').value;
    const note = document.getElementById('scan-note').value;

    if (!amount) {
        alert('Please enter a valid amount');
        return;
    }

    const newExpense = {
        id: Date.now().toString(),
        type: 'expense',
        amount,
        category: category || 'Uncategorized',
        note,
        recurring: false,
        date: new Date().toISOString()
    };

    expenses.push(newExpense);
    await db.expenses.add(newExpense);
    
    renderDashboard();

    // Go back to dashboard
    document.querySelector('[data-target="view-dashboard"]').click();
}

// Manual Form Logic
function initManualForm() {
    const showBtn = document.getElementById('show-manual-form-btn');
    const form = document.getElementById('manual-form');
    const cancelBtn = document.getElementById('cancel-manual-btn');
    const saveBtn = document.getElementById('save-manual-btn');
    const typeSelect = document.getElementById('manual-type');
    const recurringGroup = document.getElementById('recurring-group');
    
    // Show recurring option only for income
    typeSelect.addEventListener('change', () => {
        if (typeSelect.value === 'income') {
            recurringGroup.classList.remove('hidden');
        } else {
            recurringGroup.classList.add('hidden');
            document.getElementById('manual-recurring').checked = false;
        }
    });

    showBtn.addEventListener('click', () => {
        form.classList.remove('hidden');
        showBtn.classList.add('hidden');
    });
    
    cancelBtn.addEventListener('click', () => {
        form.classList.add('hidden');
        showBtn.classList.remove('hidden');
        clearManualForm();
    });
    
    saveBtn.addEventListener('click', async () => {
        const type = typeSelect.value;
        const amount = parseFloat(document.getElementById('manual-amount').value);
        const category = document.getElementById('manual-category').value;
        const note = document.getElementById('manual-note').value;
        const recurring = document.getElementById('manual-recurring').checked;
        
        if (!amount) {
            alert('Please enter a valid amount');
            return;
        }
        
        const newExpense = {
            id: Date.now().toString(),
            type: type,
            amount,
            category: category || 'Uncategorized',
            note,
            recurring: type === 'income' ? recurring : false,
            date: new Date().toISOString()
        };

        expenses.push(newExpense);
        await db.expenses.add(newExpense);
        
        renderDashboard();
        
        form.classList.add('hidden');
        showBtn.classList.remove('hidden');
        clearManualForm();
    });
}

function clearManualForm() {
    document.getElementById('manual-amount').value = '';
    document.getElementById('manual-category').value = '';
    document.getElementById('manual-note').value = '';
    document.getElementById('manual-type').value = 'expense';
    document.getElementById('manual-recurring').checked = false;
    document.getElementById('recurring-group').classList.add('hidden');
}

// Data Management
async function loadData() {
    // 1. First time migration from localStorage if exists
    const legacySaved = localStorage.getItem('family_expenses');
    if (legacySaved) {
        const legacyArray = JSON.parse(legacySaved);
        // Put legacy data into IndexedDB
        for (const item of legacyArray) {
            if (!item.type) item.type = 'expense';
            // Use put to avoid constraint errors if running twice
            await db.expenses.put(item); 
        }
        localStorage.removeItem('family_expenses'); // Clean up old system
    }

    // 2. Load from IndexedDB
    expenses = await db.expenses.toArray();

    // 3. Load Budgets
    const savedBudgets = await db.budgets.toArray();
    if (savedBudgets.length > 0) {
        categoryBudgets = {};
        savedBudgets.forEach(b => categoryBudgets[b.category] = b.limit);
    } else {
        // Seed default budgets on first load
        for (const cat of Object.keys(categoryBudgets)) {
            await db.budgets.put({ category: cat, limit: categoryBudgets[cat] });
        }
    }

    // 4. Load Accounts
    accounts = await db.accounts.toArray();
    
    // Automatically add Savings and Investments if they don't exist yet
    const hasSavings = accounts.some(a => a.type === 'savings');
    const hasInvestment = accounts.some(a => a.type === 'investment');
    
    const newDefaults = [];
    if (accounts.length === 0) {
        newDefaults.push({ id: 'acc1', name: 'My Checking', type: 'bank', balance: 0 });
        newDefaults.push({ id: 'acc_wife', name: 'Wife Checking', type: 'bank', balance: 0 });
        newDefaults.push({ id: 'acc2', name: 'Credit Card', type: 'credit', balance: 0 });
    } else {
        // Upgrade existing "Checking Account" to the split setup for returning user
        const baseChecking = accounts.find(a => a.name === 'Checking Account');
        if (baseChecking) {
            baseChecking.name = 'My Checking';
            await db.accounts.put(baseChecking);
        }
        const hasWifeChecking = accounts.some(a => a.name === 'Wife Checking');
        if (!hasWifeChecking) {
            const wifeAcc = { id: 'acc_wife', name: 'Wife Checking', type: 'bank', balance: 0 };
            await db.accounts.put(wifeAcc);
            accounts.push(wifeAcc);
        }
    }

    if (!hasSavings) {
        newDefaults.push({ id: 'acc3', name: 'Savings Account', type: 'savings', balance: 0 });
    }
    if (!hasInvestment) {
        newDefaults.push({ id: 'acc4', name: 'Investment Portfolio', type: 'investment', balance: 0 });
    }

    if (newDefaults.length > 0) {
        await db.accounts.bulkAdd(newDefaults);
        accounts.push(...newDefaults);
    }

    // 5. Load Goals
    goals = await db.goals.toArray();
    if (goals.length === 0) {
        const defaultGoal = { id: 'goal1', name: 'Emergency Fund', targetAmount: 5000, currentAmount: 1000 };
        await db.goals.put(defaultGoal);
        goals.push(defaultGoal);
    }
}

async function processRecurringTransactions() {
    const now = new Date();
    const currentMonthKey = now.getFullYear() + '-' + now.getMonth();
    const lastCheckKey = localStorage.getItem('last_recurring_check');

    if (lastCheckKey !== currentMonthKey) {
        const recurringIncomes = expenses.filter(e => e.recurring && e.type === 'income');
        
        if (recurringIncomes.length > 0 && lastCheckKey) {
            const newIncomes = recurringIncomes.map(inc => ({
                id: Date.now().toString() + Math.random(),
                type: 'income',
                amount: inc.amount,
                category: inc.category,
                note: inc.note + ' (Auto)',
                recurring: false,
                date: now.toISOString()
            }));

            // Bulk add to DB
            await db.expenses.bulkAdd(newIncomes);
            expenses.push(...newIncomes);
        }
        
        localStorage.setItem('last_recurring_check', currentMonthKey);
    }
}

// Render the individual transaction HTML
function createExpenseElement(exp) {
    const el = document.createElement('div');
    el.className = 'expense-item';
    
    const dateStr = new Date(exp.date).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
    const isIncome = exp.type === 'income';
    const sign = isIncome ? '+' : '-';
    const colorClass = isIncome ? 'positive' : '';
    
    el.innerHTML = `
        <div class="expense-info">
            <div class="expense-cat">${exp.category || 'Uncategorized'} ${exp.recurring ? '🔄' : ''}</div>
            <div class="expense-meta">${exp.note} • ${dateStr}</div>
        </div>
        <div class="expense-amount ${colorClass}">${sign}€${exp.amount.toFixed(2)}</div>
    `;
    return el;
}

// UI Rendering
function renderDashboard() {
    let totalIncome = 0;
    let totalExpense = 0;
    
    // Sort descending by date
    const sorted = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Calculate totals for all time
    expenses.forEach(exp => {
        if (exp.type === 'income') totalIncome += exp.amount;
        else totalExpense += exp.amount;
    });

    const netBalance = totalIncome - totalExpense;

    // 1. Dashboard Mini List
    const dashList = document.getElementById('recent-expenses-list');
    dashList.innerHTML = '';
    sorted.slice(0, 5).forEach(exp => dashList.appendChild(createExpenseElement(exp)));

    if (sorted.length === 0) {
        dashList.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">No transactions yet. Tap to add one!</div>';
    }

    // Update Dashboard Header 
    const balanceEl = document.getElementById('total-balance');
    balanceEl.textContent = `€${netBalance.toFixed(2)}`;
    balanceEl.style.color = netBalance >= 0 ? 'var(--text-primary)' : 'var(--danger)';

    document.getElementById('dashboard-income').textContent = `+€${totalIncome.toFixed(2)}`;
    document.getElementById('dashboard-expenses').textContent = `-€${totalExpense.toFixed(2)}`;

    // Render Accounts
    renderAccounts();

    // Render Goals
    renderGoals();

    // 2. Full Ledger List
    renderAllTransactions(sorted);

    // 3. Render Budget
    renderBudget();

    // 4. Render Reports
    renderReports();
}

function initAccountForm() {
    const toggleBtn = document.getElementById('toggle-account-form');
    const form = document.getElementById('account-edit-form');
    const saveBtn = document.getElementById('save-account-btn');
    if(!toggleBtn || !form) return;

    toggleBtn.addEventListener('click', () => {
        form.classList.toggle('hidden');
        toggleBtn.textContent = form.classList.contains('hidden') ? 'Manage' : 'Done';
    });

    saveBtn.addEventListener('click', async () => {
        const name = document.getElementById('new-acc-name').value.trim();
        const type = document.getElementById('new-acc-type').value;
        const balance = parseFloat(document.getElementById('new-acc-balance').value);
        if (!name || isNaN(balance)) return alert('Enter valid name and balance');

        const newAcc = { id: Date.now().toString(), name, type, balance };
        accounts.push(newAcc);
        await db.accounts.put(newAcc);
        
        document.getElementById('new-acc-name').value = '';
        document.getElementById('new-acc-balance').value = '';
        renderAccounts();
    });
}
document.addEventListener('DOMContentLoaded', initAccountForm);

function updateAccountBalance(id, newBalance) {
    const acc = accounts.find(a => a.id === id);
    if (acc) {
        acc.balance = newBalance;
        db.accounts.put(acc);
        renderAccounts();
    }
}
window.updateAccountBalance = updateAccountBalance; // Expose for inline onclick

window.deleteAccount = async function(id) {
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    if (confirm(`Are you sure you want to delete the account "${acc.name}"?`)) {
        accounts = accounts.filter(a => a.id !== id);
        await db.accounts.delete(id);
        renderAccounts();
    }
};

function renderAccounts() {
    const listEl = document.getElementById('accounts-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    
    let netWorth = 0;
    
    accounts.forEach(acc => {
        // Compute net worth: credit cards subtract from net worth
        if(acc.type === 'credit') netWorth -= Math.abs(acc.balance);
        else netWorth += acc.balance;

        const el = document.createElement('div');
        el.style.display = 'flex';
        el.style.justifyContent = 'space-between';
        el.style.alignItems = 'center';
        el.style.padding = '12px 0';
        el.style.borderBottom = '1px solid var(--border)';
        
        const isCredit = acc.type === 'credit';
        // In a credit card, usually positive balance means debt. We show it as negative logically.
        const displayBal = isCredit ? `-€${Math.abs(acc.balance).toFixed(2)}` : `€${acc.balance.toFixed(2)}`;
        
        el.innerHTML = `
            <div>
                <div style="font-weight: 600; font-size: 0.95rem;">${acc.name}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary); text-transform: capitalize;">${acc.type}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-weight: 600; color: ${isCredit ? 'var(--text-primary)' : 'var(--success)'};">${displayBal}</span>
                <span style="cursor:pointer; color: var(--text-secondary); font-size: 1.2rem;" onclick="const nb = prompt('Update balance for ${acc.name}', '${acc.balance}'); if(nb !== null && !isNaN(nb)) window.updateAccountBalance('${acc.id}', parseFloat(nb));" title="Edit Balance">✏️</span>
                <span style="cursor:pointer; color: var(--danger); font-size: 1.1rem;" onclick="window.deleteAccount('${acc.id}')" title="Delete Account">✖</span>
            </div>
        `;
        listEl.appendChild(el);
    });

    document.getElementById('net-worth-display').textContent = `€${netWorth.toFixed(2)}`;
}

function initGoalForm() {
    const toggleBtn = document.getElementById('toggle-goal-form');
    const form = document.getElementById('goal-edit-form');
    const saveBtn = document.getElementById('save-goal-btn');
    if(!toggleBtn || !form) return;

    toggleBtn.addEventListener('click', () => {
        form.classList.toggle('hidden');
        toggleBtn.textContent = form.classList.contains('hidden') ? 'Manage' : 'Done';
    });

    saveBtn.addEventListener('click', async () => {
        const name = document.getElementById('new-goal-name').value.trim();
        const currentAmount = parseFloat(document.getElementById('new-goal-current').value) || 0;
        const targetAmount = parseFloat(document.getElementById('new-goal-target').value);
        
        if (!name || isNaN(targetAmount)) return alert('Enter a valid goal name and target amount.');

        const newGoal = { id: Date.now().toString(), name, currentAmount, targetAmount };
        goals.push(newGoal);
        await db.goals.put(newGoal);
        
        document.getElementById('new-goal-name').value = '';
        document.getElementById('new-goal-current').value = '';
        document.getElementById('new-goal-target').value = '';
        renderGoals();
    });
}

function updateGoalBalance(id, currentSaved) {
    const goal = goals.find(g => g.id === id);
    if (goal) {
        goal.currentAmount = currentSaved;
        db.goals.put(goal);
        renderGoals();
    }
}
window.updateGoalBalance = updateGoalBalance;

window.editGoalInfo = async function(id) {
    const goal = goals.find(g => g.id === id);
    if (!goal) return;
    
    const newCurrent = prompt(`Update CURRENT saved amount for ${goal.name}:`, goal.currentAmount);
    if (newCurrent === null || isNaN(newCurrent)) return;
    
    const newTarget = prompt(`Update FINAL TARGET amount for ${goal.name}:`, goal.targetAmount);
    if (newTarget === null || isNaN(newTarget)) return;

    goal.currentAmount = parseFloat(newCurrent);
    goal.targetAmount = parseFloat(newTarget);
    
    await db.goals.put(goal);
    renderGoals();
};

window.deleteGoal = async function(id) {
    const goal = goals.find(g => g.id === id);
    if (!goal) return;
    if (confirm(`Are you sure you want to delete the goal "${goal.name}"?`)) {
        goals = goals.filter(g => g.id !== id);
        await db.goals.delete(id);
        renderGoals();
    }
};

function renderGoals() {
    const listEl = document.getElementById('goals-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    
    if (goals.length === 0) {
        listEl.innerHTML = '<div style="color:var(--text-secondary); text-align:center; padding:10px;">No goals yet.</div>';
        return;
    }
    
    goals.forEach(goal => {
        const percentage = Math.min((goal.currentAmount / goal.targetAmount) * 100, 100);
        
        let barColor = '#10b981'; // Green for goals
        if (percentage < 30) barColor = 'var(--text-secondary)';
        else if (percentage < 70) barColor = 'var(--accent)';

        const el = document.createElement('div');
        el.style.padding = '16px';
        el.style.borderBottom = '1px solid var(--border)';
        el.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-weight: 600;">${goal.name}</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="color: var(--text-secondary); font-size: 0.9rem;">
                        €${goal.currentAmount.toFixed(2)} / €${goal.targetAmount.toFixed(2)}
                    </span>
                    <span style="cursor:pointer; font-size:1.1rem; color:var(--text-secondary);" onclick="window.editGoalInfo('${goal.id}')" title="Edit Goal Amounts">✏️</span>
                    <span style="cursor:pointer; font-size:1.1rem; color:var(--danger);" onclick="window.deleteGoal('${goal.id}')" title="Delete">✖</span>
                </div>
            </div>
            <div style="width: 100%; height: 8px; background: var(--bg-main); border-radius: 4px; overflow: hidden;">
                <div style="width: ${percentage}%; height: 100%; background: ${barColor}; border-radius: 4px; transition: width 0.3s ease;"></div>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 6px; text-align:right;">
                ${percentage.toFixed(0)}%
            </div>
        `;
        listEl.appendChild(el);
    });
}

function renderAllTransactions(sorted) {
    const listEl = document.getElementById('all-transactions-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    
    sorted.forEach(exp => listEl.appendChild(createExpenseElement(exp)));
    
    if (sorted.length === 0) {
        listEl.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">Your ledger is clean!</div>';
    }
}

function renderReports() {
    if (!document.getElementById('expenseChart')) return;
    
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const catData = {};
    const monthsData = {};
    
    for(let i=5; i>=0; i--) {
        const d = new Date(currentYear, currentMonth - i, 1);
        const label = d.toLocaleDateString(undefined, {month:'short', year:'2-digit'});
        monthsData[label] = { inc: 0, exp: 0 };
    }

    expenses.forEach(exp => {
        const d = new Date(exp.date);
        
        if (exp.type === 'expense' && d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
            const cat = exp.category || 'Other';
            catData[cat] = (catData[cat] || 0) + exp.amount;
        }
        
        const label = d.toLocaleDateString(undefined, {month:'short', year:'2-digit'});
        if (monthsData[label]) {
            if (exp.type === 'income') monthsData[label].inc += exp.amount;
            else monthsData[label].exp += exp.amount;
        }
    });

    if (expenseChartInstance) expenseChartInstance.destroy();
    if (cashflowChartInstance) cashflowChartInstance.destroy();

    const ctxExp = document.getElementById('expenseChart').getContext('2d');
    expenseChartInstance = new Chart(ctxExp, {
        type: 'doughnut',
        data: {
            labels: Object.keys(catData),
            datasets: [{
                data: Object.values(catData),
                backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b', '#0ea5e9', '#d946ef']
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });

    const ctxCash = document.getElementById('cashflowChart').getContext('2d');
    const labels = Object.keys(monthsData);
    cashflowChartInstance = new Chart(ctxCash, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Income', data: labels.map(l => monthsData[l].inc), backgroundColor: '#10b981' },
                { label: 'Expenses', data: labels.map(l => monthsData[l].exp), backgroundColor: '#ef4444' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function initBudgetForm() {
    const toggleBtn = document.getElementById('toggle-edit-budget-btn');
    const form = document.getElementById('budget-edit-form');
    const saveBtn = document.getElementById('save-budget-cat-btn');
    if(!toggleBtn || !form) return;

    toggleBtn.addEventListener('click', () => {
        form.classList.toggle('hidden');
        toggleBtn.textContent = form.classList.contains('hidden') ? 'Edit Mode' : 'Done';
    });

    saveBtn.addEventListener('click', async () => {
        const cat = document.getElementById('new-budget-cat').value.trim();
        const lim = parseFloat(document.getElementById('new-budget-limit').value);
        if (!cat || !lim) {
            alert('Please enter a valid category name and budget limit.');
            return;
        }

        categoryBudgets[cat] = lim;
        await db.budgets.put({ category: cat, limit: lim });
        
        document.getElementById('new-budget-cat').value = '';
        document.getElementById('new-budget-limit').value = '';
        renderBudget();
    });
}

function renderBudget() {
    const budgetList = document.getElementById('budget-list');
    if (!budgetList) return;
    budgetList.innerHTML = '';

    // Sum current month expenses per category
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const spentPerCategory = {};

    expenses.forEach(exp => {
        if (exp.type !== 'expense') return;
        const d = new Date(exp.date);
        if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
            const cat = exp.category || 'Other';
            spentPerCategory[cat] = (spentPerCategory[cat] || 0) + exp.amount;
        }
    });

    Object.keys(categoryBudgets).forEach(cat => {
        const limit = categoryBudgets[cat];
        const spent = spentPerCategory[cat] || 0;
        const percentage = Math.min((spent / limit) * 100, 100);
        
        // Progress bar color logic
        let barColor = 'var(--accent)';
        if (percentage > 90) barColor = 'var(--danger)';
        else if (percentage > 70) barColor = '#f59e0b'; // warning orange

        const el = document.createElement('div');
        el.style.padding = '16px';
        el.style.borderBottom = '1px solid var(--border)';
        el.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-weight: 600;">${cat}</span>
                <span style="color: var(--text-secondary); font-size: 0.9rem;">€${spent.toFixed(2)} / €${limit}</span>
            </div>
            <div style="width: 100%; height: 8px; background: var(--bg-main); border-radius: 4px; overflow: hidden;">
                <div style="width: ${percentage}%; height: 100%; background: ${barColor}; border-radius: 4px; transition: width 0.3s ease;"></div>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 6px;">
                ${(limit - spent) >= 0 ? `€${(limit - spent).toFixed(2)} left` : `€${Math.abs(limit - spent).toFixed(2)} over limit`}
            </div>
        `;
        budgetList.appendChild(el);
    });
}

// Settings
function initSettingsForm() {
    const keyInput = document.getElementById('gemini-key');
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) keyInput.value = savedKey;

    keyInput.addEventListener('change', (e) => {
        localStorage.setItem('gemini_api_key', e.target.value);
    });
}

function updateSyncStatus() {
    const statusEl = document.getElementById('sync-status');
    // For demo; this would update based on Google Auth status
    statusEl.innerHTML = `Last saved locally at ${new Date().toLocaleTimeString()}`;
}
