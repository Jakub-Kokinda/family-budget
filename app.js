// app.js
import { GoogleGenerativeAI } from 'https://esm.run/@google/generative-ai';

// ─── PASTE YOUR FIREBASE CONFIG HERE ────────────────────────────────────────
// Get this from: Firebase Console → Project Settings → Your Apps → Web app
const firebaseConfig = {
    apiKey: "AIzaSyCAYu0n8CFqO7JDNl3PpRNV0kZtrohKVDY",
    authDomain: "family-budget-c30e8.firebaseapp.com",
    projectId: "family-budget-c30e8",
    storageBucket: "family-budget-c30e8.firebasestorage.app",
    messagingSenderId: "846797557368",
    appId: "1:846797557368:web:44606a463e262021c6e78d"
};
// ────────────────────────────────────────────────────────────────────────────

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const firestore = firebase.firestore();

// State
let expenses = [];
let accounts = [];
let goals = [];
let categoryBudgets = {};
let stream = null;
let familyRef = null;       // Firestore ref to families/{familyId}
let dataInitialized = false;

// Chart instances
let expenseChartInstance = null;
let cashflowChartInstance = null;

// Default data seeded for every new family
const DEFAULT_BUDGETS = { Groceries: 500, Housing: 1200, Transport: 300, Fun: 200, Utilities: 150 };
const DEFAULT_ACCOUNTS = [
    { id: 'acc1',      name: 'My Checking',        type: 'bank',       balance: 0 },
    { id: 'acc_wife',  name: 'Wife Checking',       type: 'bank',       balance: 0 },
    { id: 'acc3',      name: 'Savings Account',     type: 'savings',    balance: 0 },
    { id: 'acc4',      name: 'Investment Portfolio', type: 'investment', balance: 0 },
];
const DEFAULT_GOALS = [
    { id: 'goal1', name: 'Emergency Fund', targetAmount: 5000, currentAmount: 1000 }
];

// ─── Startup ─────────────────────────────────────────────────────────────────
// Wait for Firebase to tell us whether the user is logged in or not.
// This fires once immediately on page load, then again any time login/logout happens.
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initAuthForm();
    initFamilyForm();

    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            showScreen('auth');
            return;
        }
        const familyId = await getFamilyId(user.uid);
        if (!familyId) {
            showScreen('family');
            return;
        }
        familyRef = firestore.collection('families').doc(familyId);
        showScreen('app');
        subscribeToData();
        initSettingsForm(familyId);
        initManualForm();
        initBudgetForm();
        initAccountForm();
        initGoalForm();
        populateCategoryDropdown();
    });
});

// Switch between the three full-screen states: auth, family setup, or the main app
function showScreen(name) {
    document.getElementById('auth-screen').style.display   = name === 'auth'   ? 'flex' : 'none';
    document.getElementById('family-screen').style.display = name === 'family' ? 'flex' : 'none';
    document.getElementById('app').style.display           = name === 'app'    ? 'flex' : 'none';
}

// ─── Authentication ───────────────────────────────────────────────────────────
function initAuthForm() {
    document.getElementById('btn-login').onclick = async () => {
        const email    = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const errorEl  = document.getElementById('auth-error');
        errorEl.textContent = '';
        try {
            await auth.signInWithEmailAndPassword(email, password);
            // auth.onAuthStateChanged will fire automatically and continue the flow
        } catch (e) {
            errorEl.textContent = e.message;
        }
    };

    document.getElementById('btn-signup').onclick = async () => {
        const email    = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const errorEl  = document.getElementById('auth-error');
        errorEl.textContent = '';
        try {
            await auth.createUserWithEmailAndPassword(email, password);
            // After signup, auth state change fires → shows family screen (no familyId yet)
        } catch (e) {
            errorEl.textContent = e.message;
        }
    };
}

// ─── Family Setup ─────────────────────────────────────────────────────────────
function initFamilyForm() {
    document.getElementById('btn-create-family').onclick = async () => {
        const user = auth.currentUser;
        if (!user) return;
        try {
            const code = await createFamily(user.uid);
            alert(`Your family code is: ${code}\n\nWrite it down and share it with your wife so she can join.`);
            familyRef = firestore.collection('families').doc(code);
            showScreen('app');
            subscribeToData();
            initSettingsForm(code);
            initManualForm();
            initBudgetForm();
            initAccountForm();
            initGoalForm();
        } catch (e) {
            alert('Error creating family: ' + e.message);
        }
    };

    document.getElementById('btn-join-family').onclick = async () => {
        const user = auth.currentUser;
        if (!user) return;
        const code = document.getElementById('family-code-input').value.trim().toUpperCase();
        if (!code) return alert('Please enter a family code.');
        try {
            await joinFamily(user.uid, code);
            familyRef = firestore.collection('families').doc(code);
            showScreen('app');
            subscribeToData();
            initSettingsForm(code);
            initManualForm();
            initBudgetForm();
            initAccountForm();
            initGoalForm();
        } catch (e) {
            alert(e.message);
        }
    };
}

// Look up which family this user belongs to (stored in users/{uid})
async function getFamilyId(uid) {
    const doc = await firestore.collection('users').doc(uid).get();
    return doc.exists ? doc.data().familyId : null;
}

// Create a new family with a random 6-char code, seed default data, save user's familyId
async function createFamily(uid) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const famRef = firestore.collection('families').doc(code);

    await famRef.set({ createdBy: uid, createdAt: new Date().toISOString() });

    for (const [cat, limit] of Object.entries(DEFAULT_BUDGETS)) {
        await famRef.collection('budgets').doc(cat).set({ limit });
    }
    for (const acc of DEFAULT_ACCOUNTS) {
        await famRef.collection('accounts').doc(acc.id).set(acc);
    }
    for (const goal of DEFAULT_GOALS) {
        await famRef.collection('goals').doc(goal.id).set(goal);
    }

    await firestore.collection('users').doc(uid).set({ familyId: code });
    return code;
}

// Join an existing family using a code person 1 shared
async function joinFamily(uid, code) {
    const doc = await firestore.collection('families').doc(code).get();
    if (!doc.exists) throw new Error('Family code not found. Check the code and try again.');
    await firestore.collection('users').doc(uid).set({ familyId: code });
}

// ─── Real-time data subscriptions ────────────────────────────────────────────
// onSnapshot fires once immediately with current data, then again on every change.
// This replaces the old loadData() function.
function subscribeToData() {
    dataInitialized = false;

    familyRef.collection('expenses').onSnapshot(snap => {
        expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!dataInitialized) {
            dataInitialized = true;
            // On first load, check if we need to auto-create this month's recurring incomes
            processRecurringTransactions().then(() => {
                renderDashboard();
                populateCategoryDropdown();
            });
        } else {
            renderDashboard();
            populateCategoryDropdown();
        }
    });

    familyRef.collection('budgets').onSnapshot(snap => {
        categoryBudgets = {};
        snap.docs.forEach(d => { categoryBudgets[d.id] = d.data().limit; });
        renderBudget();
        populateCategoryDropdown();
    });

    familyRef.collection('accounts').onSnapshot(snap => {
        accounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAccounts();
    });

    familyRef.collection('goals').onSnapshot(snap => {
        goals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderGoals();
    });
}

// Fills the category dropdown in the manual entry form
function populateCategoryDropdown() {
    const select = document.getElementById('manual-category');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '';
    const cats = Object.keys(categoryBudgets);
    if (cats.length === 0) cats.push('Uncategorized');
    cats.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
    });
    if (current) select.value = current;
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const views   = document.querySelectorAll('.view');

    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            navBtns.forEach(b => b.classList.remove('active'));
            const targetBtn    = e.target.closest('.nav-btn');
            targetBtn.classList.add('active');
            const targetViewId = targetBtn.getAttribute('data-target');

            if (targetViewId === 'view-scan') {
                startCamera();
            } else {
                stopCamera();
            }

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

// ─── Camera & OCR ─────────────────────────────────────────────────────────────
async function startCamera() {
    const video = document.getElementById('camera-stream');
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false
        });
        video.srcObject = stream;
        document.getElementById('capture-btn').addEventListener('click', captureImage, { once: true });
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
    document.getElementById('scan-results').classList.add('hidden');
    document.getElementById('scanner-form').classList.add('hidden');
    document.getElementById('scanner-loading').classList.add('hidden');
    document.getElementById('scanned-image').style.display = 'none';
    document.getElementById('camera-stream').style.display = 'block';
}

async function captureImage() {
    const video  = document.getElementById('camera-stream');
    const canvas = document.getElementById('camera-canvas');
    const img    = document.getElementById('scanned-image');

    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    const base64Img = canvas.toDataURL('image/jpeg', 0.8);
    img.src = base64Img;

    video.style.display = 'none';
    img.style.display   = 'block';

    stopCamera();

    const scanResults = document.getElementById('scan-results');
    const loading     = document.getElementById('scanner-loading');
    const form        = document.getElementById('scanner-form');

    scanResults.classList.remove('hidden');
    loading.classList.remove('hidden');
    form.classList.add('hidden');

    await analyzeReceiptWithGemini(base64Img);
}

async function analyzeReceiptWithGemini(base64Image) {
    const apiKey  = localStorage.getItem('gemini_api_key');
    const loading = document.getElementById('scanner-loading');
    const form    = document.getElementById('scanner-form');

    if (!apiKey) {
        alert('Please set your Gemini API key in Settings first.');
        loading.classList.add('hidden');
        form.classList.remove('hidden');
        return;
    }

    try {
        const genAI    = new GoogleGenerativeAI(apiKey);
        const model    = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const base64Data = base64Image.split(',')[1];

        const prompt = `Analyze this receipt. Return ONLY a valid JSON object with these keys:
        "amount" (number, total amount),
        "category" (string, short category like 'Groceries' or 'Transport'),
        "merchant" (string, name of the store).
        Do not include markdown blocks or any other text.`;

        const result       = await model.generateContent([prompt, { inlineData: { data: base64Data, mimeType: "image/jpeg" } }]);
        const responseText = result.response.text().trim();
        const jsonStr      = responseText.replace(/```json/g, '').replace(/```/g, '');
        const data         = JSON.parse(jsonStr);

        document.getElementById('scan-amount').value   = data.amount   || '';
        document.getElementById('scan-category').value = data.category || '';
        document.getElementById('scan-note').value     = data.merchant || '';
    } catch (err) {
        console.error('Gemini error:', err);
        alert('Failed to analyze image. Please fill details manually.');
    } finally {
        loading.classList.add('hidden');
        form.classList.remove('hidden');
        document.getElementById('save-scan-btn').onclick = async () => await saveScannedExpense();
    }
}

async function saveScannedExpense() {
    const amount   = parseFloat(document.getElementById('scan-amount').value);
    const category = document.getElementById('scan-category').value;
    const note     = document.getElementById('scan-note').value;

    if (!amount) {
        alert('Please enter a valid amount');
        return;
    }

    await familyRef.collection('expenses').add({
        type: 'expense',
        amount,
        category: category || 'Uncategorized',
        note,
        recurring: false,
        date: new Date().toISOString()
    });
    // onSnapshot will update expenses and re-render the dashboard

    document.querySelector('[data-target="view-dashboard"]').click();
}

// ─── Manual Entry Form ────────────────────────────────────────────────────────
function initManualForm() {
    const showBtn       = document.getElementById('show-manual-form-btn');
    const form          = document.getElementById('manual-form');
    const cancelBtn     = document.getElementById('cancel-manual-btn');
    const saveBtn       = document.getElementById('save-manual-btn');
    const typeSelect    = document.getElementById('manual-type');
    const recurringGroup = document.getElementById('recurring-group');

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
        const type      = typeSelect.value;
        const amount    = parseFloat(document.getElementById('manual-amount').value);
        const category  = document.getElementById('manual-category').value;
        const note      = document.getElementById('manual-note').value;
        const recurring = document.getElementById('manual-recurring').checked;

        if (!amount) {
            alert('Please enter a valid amount');
            return;
        }

        await familyRef.collection('expenses').add({
            type,
            amount,
            category: category || 'Uncategorized',
            note,
            recurring: type === 'income' ? recurring : false,
            date: new Date().toISOString()
        });
        // onSnapshot fires and re-renders dashboard automatically

        form.classList.add('hidden');
        showBtn.classList.remove('hidden');
        clearManualForm();
    });
}

function clearManualForm() {
    document.getElementById('manual-amount').value    = '';
    document.getElementById('manual-category').value  = '';
    document.getElementById('manual-note').value      = '';
    document.getElementById('manual-type').value      = 'expense';
    document.getElementById('manual-recurring').checked = false;
    document.getElementById('recurring-group').classList.add('hidden');
}

// Auto-create this month's recurring incomes if not already done
async function processRecurringTransactions() {
    const now             = new Date();
    const currentMonthKey = now.getFullYear() + '-' + now.getMonth();
    const lastCheckKey    = localStorage.getItem('last_recurring_check');

    if (lastCheckKey !== currentMonthKey) {
        const recurringIncomes = expenses.filter(e => e.recurring && e.type === 'income');

        if (recurringIncomes.length > 0 && lastCheckKey) {
            for (const inc of recurringIncomes) {
                await familyRef.collection('expenses').add({
                    type: 'income',
                    amount: inc.amount,
                    category: inc.category,
                    note: inc.note + ' (Auto)',
                    recurring: false,
                    date: now.toISOString()
                });
            }
        }
        localStorage.setItem('last_recurring_check', currentMonthKey);
    }
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function createExpenseElement(exp) {
    const el      = document.createElement('div');
    el.className  = 'expense-item';
    const dateStr = new Date(exp.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const isIncome   = exp.type === 'income';
    const sign       = isIncome ? '+' : '-';
    const colorClass = isIncome ? 'positive' : '';

    el.innerHTML = `
        <div class="expense-info">
            <div class="expense-cat">${exp.category || 'Uncategorized'} ${exp.recurring ? '🔄' : ''}</div>
            <div class="expense-meta">${exp.note} • ${dateStr}</div>
        </div>
        <div class="expense-amount ${colorClass}">${sign}€${exp.amount.toFixed(2)}</div>
        <span style="cursor:pointer; color:var(--danger); font-size:1.1rem; margin-left:10px;" onclick="window.deleteExpense('${exp.id}')" title="Delete">✖</span>
    `;
    return el;
}

window.deleteExpense = async function(id) {
    if (confirm('Delete this transaction?')) {
        await familyRef.collection('expenses').doc(id).delete();
    }
};

function renderDashboard() {
    let totalIncome  = 0;
    let totalExpense = 0;
    const sorted     = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date));

    expenses.forEach(exp => {
        if (exp.type === 'income') totalIncome  += exp.amount;
        else                       totalExpense += exp.amount;
    });

    const netBalance = totalIncome - totalExpense;

    const dashList = document.getElementById('recent-expenses-list');
    dashList.innerHTML = '';
    sorted.slice(0, 5).forEach(exp => dashList.appendChild(createExpenseElement(exp)));

    if (sorted.length === 0) {
        dashList.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">No transactions yet. Tap to add one!</div>';
    }

    const balanceEl = document.getElementById('total-balance');
    balanceEl.textContent  = `€${netBalance.toFixed(2)}`;
    balanceEl.style.color  = netBalance >= 0 ? 'var(--text-primary)' : 'var(--danger)';

    document.getElementById('dashboard-income').textContent   = `+€${totalIncome.toFixed(2)}`;
    document.getElementById('dashboard-expenses').textContent = `-€${totalExpense.toFixed(2)}`;

    renderAccounts();
    renderGoals();
    renderAllTransactions(sorted);
    renderBudget();
    renderReports();
}

// ─── Accounts ─────────────────────────────────────────────────────────────────
function initAccountForm() {
    const toggleBtn = document.getElementById('toggle-account-form');
    const form      = document.getElementById('account-edit-form');
    const saveBtn   = document.getElementById('save-account-btn');
    if (!toggleBtn || !form) return;

    toggleBtn.addEventListener('click', () => {
        form.classList.toggle('hidden');
        toggleBtn.textContent = form.classList.contains('hidden') ? 'Manage' : 'Done';
    });

    saveBtn.addEventListener('click', async () => {
        const name    = document.getElementById('new-acc-name').value.trim();
        const type    = document.getElementById('new-acc-type').value;
        const balance = parseFloat(document.getElementById('new-acc-balance').value);
        if (!name || isNaN(balance)) return alert('Enter valid name and balance');

        await familyRef.collection('accounts').add({ name, type, balance });
        // onSnapshot will update accounts and re-render

        document.getElementById('new-acc-name').value    = '';
        document.getElementById('new-acc-balance').value = '';
    });
}

function updateAccountBalance(id, newBalance) {
    familyRef.collection('accounts').doc(id).update({ balance: newBalance });
    // onSnapshot will re-render
}
window.updateAccountBalance = updateAccountBalance;

window.deleteAccount = async function(id) {
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    if (confirm(`Are you sure you want to delete the account "${acc.name}"?`)) {
        await familyRef.collection('accounts').doc(id).delete();
    }
};

function renderAccounts() {
    const listEl = document.getElementById('accounts-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    let netWorth = 0;

    accounts.forEach(acc => {
        netWorth += acc.balance;

        const el = document.createElement('div');
        el.style.display        = 'flex';
        el.style.justifyContent = 'space-between';
        el.style.alignItems     = 'center';
        el.style.padding        = '12px 0';
        el.style.borderBottom   = '1px solid var(--border)';

        const displayBal = `€${acc.balance.toFixed(2)}`;
        el.innerHTML = `
            <div>
                <div style="font-weight: 600; font-size: 0.95rem;">${acc.name}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary); text-transform: capitalize;">${acc.type}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-weight: 600; color: var(--success);">${displayBal}</span>
                <span style="cursor:pointer; color: var(--text-secondary); font-size: 1.2rem;" onclick="const nb = prompt('Update balance for ${acc.name}', '${acc.balance}'); if(nb !== null && !isNaN(nb)) window.updateAccountBalance('${acc.id}', parseFloat(nb));" title="Edit Balance">✏️</span>
                <span style="cursor:pointer; color: var(--danger); font-size: 1.1rem;" onclick="window.deleteAccount('${acc.id}')" title="Delete Account">✖</span>
            </div>
        `;
        listEl.appendChild(el);
    });

    document.getElementById('net-worth-display').textContent = `€${netWorth.toFixed(2)}`;
}

// ─── Goals ────────────────────────────────────────────────────────────────────
function initGoalForm() {
    const toggleBtn = document.getElementById('toggle-goal-form');
    const form      = document.getElementById('goal-edit-form');
    const saveBtn   = document.getElementById('save-goal-btn');
    if (!toggleBtn || !form) return;

    toggleBtn.addEventListener('click', () => {
        form.classList.toggle('hidden');
        toggleBtn.textContent = form.classList.contains('hidden') ? 'Manage' : 'Done';
    });

    saveBtn.addEventListener('click', async () => {
        const name          = document.getElementById('new-goal-name').value.trim();
        const currentAmount = parseFloat(document.getElementById('new-goal-current').value) || 0;
        const targetAmount  = parseFloat(document.getElementById('new-goal-target').value);
        if (!name || isNaN(targetAmount)) return alert('Enter a valid goal name and target amount.');

        await familyRef.collection('goals').add({ name, currentAmount, targetAmount });

        document.getElementById('new-goal-name').value    = '';
        document.getElementById('new-goal-current').value = '';
        document.getElementById('new-goal-target').value  = '';
    });
}

function updateGoalBalance(id, currentSaved) {
    familyRef.collection('goals').doc(id).update({ currentAmount: currentSaved });
}
window.updateGoalBalance = updateGoalBalance;

window.editGoalInfo = async function(id) {
    const goal = goals.find(g => g.id === id);
    if (!goal) return;

    const newCurrent = prompt(`Update CURRENT saved amount for ${goal.name}:`, goal.currentAmount);
    if (newCurrent === null || isNaN(newCurrent)) return;
    const newTarget = prompt(`Update FINAL TARGET amount for ${goal.name}:`, goal.targetAmount);
    if (newTarget === null || isNaN(newTarget)) return;

    await familyRef.collection('goals').doc(id).update({
        currentAmount: parseFloat(newCurrent),
        targetAmount:  parseFloat(newTarget)
    });
};

window.deleteGoal = async function(id) {
    const goal = goals.find(g => g.id === id);
    if (!goal) return;
    if (confirm(`Are you sure you want to delete the goal "${goal.name}"?`)) {
        await familyRef.collection('goals').doc(id).delete();
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
        let barColor = '#10b981';
        if (percentage < 30) barColor = 'var(--text-secondary)';
        else if (percentage < 70) barColor = 'var(--accent)';

        const el = document.createElement('div');
        el.style.padding      = '16px';
        el.style.borderBottom = '1px solid var(--border)';
        el.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-weight: 600;">${goal.name}</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="color: var(--text-secondary); font-size: 0.9rem;">€${goal.currentAmount.toFixed(2)} / €${goal.targetAmount.toFixed(2)}</span>
                    <span style="cursor:pointer; font-size:1.1rem; color:var(--text-secondary);" onclick="window.editGoalInfo('${goal.id}')" title="Edit Goal Amounts">✏️</span>
                    <span style="cursor:pointer; font-size:1.1rem; color:var(--danger);" onclick="window.deleteGoal('${goal.id}')" title="Delete">✖</span>
                </div>
            </div>
            <div style="width: 100%; height: 8px; background: var(--bg-main); border-radius: 4px; overflow: hidden;">
                <div style="width: ${percentage}%; height: 100%; background: ${barColor}; border-radius: 4px; transition: width 0.3s ease;"></div>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 6px; text-align:right;">${percentage.toFixed(0)}%</div>
        `;
        listEl.appendChild(el);
    });
}

// ─── Transactions list ────────────────────────────────────────────────────────
function renderAllTransactions(sorted) {
    const listEl = document.getElementById('all-transactions-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    sorted.forEach(exp => listEl.appendChild(createExpenseElement(exp)));
    if (sorted.length === 0) {
        listEl.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">Your ledger is clean!</div>';
    }
}

// ─── Reports ──────────────────────────────────────────────────────────────────
function renderReports() {
    if (!document.getElementById('expenseChart')) return;

    const currentMonth = new Date().getMonth();
    const currentYear  = new Date().getFullYear();
    const catData      = {};
    const monthsData   = {};

    for (let i = 5; i >= 0; i--) {
        const d     = new Date(currentYear, currentMonth - i, 1);
        const label = d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
        monthsData[label] = { inc: 0, exp: 0 };
    }

    expenses.forEach(exp => {
        const d = new Date(exp.date);
        if (exp.type === 'expense' && d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
            const cat = exp.category || 'Other';
            catData[cat] = (catData[cat] || 0) + exp.amount;
        }
        const label = d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
        if (monthsData[label]) {
            if (exp.type === 'income') monthsData[label].inc += exp.amount;
            else                       monthsData[label].exp += exp.amount;
        }
    });

    if (expenseChartInstance)  expenseChartInstance.destroy();
    if (cashflowChartInstance) cashflowChartInstance.destroy();

    const ctxExp = document.getElementById('expenseChart').getContext('2d');
    expenseChartInstance = new Chart(ctxExp, {
        type: 'doughnut',
        data: {
            labels: Object.keys(catData),
            datasets: [{ data: Object.values(catData), backgroundColor: ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#64748b','#0ea5e9','#d946ef'] }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });

    const ctxCash = document.getElementById('cashflowChart').getContext('2d');
    const labels  = Object.keys(monthsData);
    cashflowChartInstance = new Chart(ctxCash, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Income',   data: labels.map(l => monthsData[l].inc), backgroundColor: '#10b981' },
                { label: 'Expenses', data: labels.map(l => monthsData[l].exp), backgroundColor: '#ef4444' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

// ─── Budget ───────────────────────────────────────────────────────────────────
function initBudgetForm() {
    const toggleBtn = document.getElementById('toggle-edit-budget-btn');
    const form      = document.getElementById('budget-edit-form');
    const saveBtn   = document.getElementById('save-budget-cat-btn');
    if (!toggleBtn || !form) return;

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
        await familyRef.collection('budgets').doc(cat).set({ limit: lim });
        // onSnapshot will update categoryBudgets, re-render budget and dropdown

        document.getElementById('new-budget-cat').value   = '';
        document.getElementById('new-budget-limit').value = '';
    });
}

function renderBudget() {
    const budgetList = document.getElementById('budget-list');
    if (!budgetList) return;
    budgetList.innerHTML = '';

    const currentMonth = new Date().getMonth();
    const currentYear  = new Date().getFullYear();
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
        const limit      = categoryBudgets[cat];
        const spent      = spentPerCategory[cat] || 0;
        const percentage = Math.min((spent / limit) * 100, 100);

        let barColor = 'var(--accent)';
        if (percentage > 90) barColor = 'var(--danger)';
        else if (percentage > 70) barColor = '#f59e0b';

        const el = document.createElement('div');
        el.style.padding      = '16px';
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

// ─── Settings ─────────────────────────────────────────────────────────────────
function initSettingsForm(familyId) {
    const keyInput = document.getElementById('gemini-key');
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) keyInput.value = savedKey;

    keyInput.addEventListener('change', (e) => {
        localStorage.setItem('gemini_api_key', e.target.value);
    });

    // Show family code and replace sync button with logout
    document.getElementById('sync-status').textContent = `Synced with Firebase · Family code: ${familyId}`;
    const syncBtn = document.getElementById('sync-drive-btn');
    syncBtn.textContent = 'Log Out';
    syncBtn.onclick = async () => {
        if (confirm('Log out of Family Budget?')) {
            await auth.signOut();
            location.reload();
        }
    };
}
