// Firebase
firebase.initializeApp({
  apiKey: "AIzaSyBJ8ikYnEStYQ4c-HjtbmDVPVazLV1hgUg",
  authDomain: "inter-nation-staff-meeting.firebaseapp.com",
  databaseURL: "https://inter-nation-staff-meeting-default-rtdb.firebaseio.com",
  projectId: "inter-nation-staff-meeting",
  storageBucket: "inter-nation-staff-meeting.firebasestorage.app",
  messagingSenderId: "209791266565",
  appId: "1:209791266565:web:5f77c238ce983e1186116c"
});
const db = firebase.database();

const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const BRANCH_KEY_MAP = {
  'samarkand': 'samarkand', 'andijan': 'andijan', 'online': 'online',
  'sergeli': 'sergeli', 'beruniy': 'beruniy', 'minor': 'minor',
  'chilonzor': 'chilonzor', 'maksim gorkiy': 'maksimgorkiy', 'maksim gorky': 'maksimgorkiy',
  'westminster': 'westminster', 'ganga': 'ganga', 'oybek': 'oybek',
  'xalqlar dostligi': 'xalqlardostligi', 'xalqlar dostligi': 'xalqlardostligi',
  'yunusabad': 'yunusabad', 'c-1': 'c1', 'c1': 'c1'
};
const REGION_MAP = {
  'samarkand': 'samarkand', 'andijan': 'andijan', 'online': 'online',
  'sergeli': 'tashkent', 'beruniy': 'tashkent', 'minor': 'tashkent',
  'chilonzor': 'tashkent', 'maksimgorkiy': 'tashkent', 'westminster': 'tashkent',
  'ganga': 'tashkent', 'oybek': 'tashkent', 'xalqlardostligi': 'tashkent',
  'yunusabad': 'tashkent', 'c1': 'tashkent'
};
const LEVEL_KEY_MAP = {
  'beginner': 'beginner', 'elementary': 'elementary',
  'pre-intermediate': 'preintermediate', 'pre intermediate': 'preintermediate',
  'intermediate': 'intermediate', 'upper-intermediate': 'upperintermediate',
  'upper intermediate': 'upperintermediate', 'ielts': 'ielts'
};
const AGE_KEY_MAP = {
  '0-14': 'age_0_14', '15-16': 'age_15_16', '17-18': 'age_17_18',
  '19-20': 'age_19_20', '21-25': 'age_21_25', '26-30': 'age_26_30', '31-70': 'age_31_70'
};

function setStatus(text, type) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = 'status show ' + type;
}

function addLog(text, type) {
  const el = document.getElementById('log');
  el.classList.add('show');
  el.innerHTML += `<p class="${type || ''}">${text}</p>`;
  el.scrollTop = el.scrollHeight;
}

function toBranchKey(name) {
  const n = (name || '').toLowerCase().trim();
  return BRANCH_KEY_MAP[n] || n.replace(/[^a-z0-9]/g, '');
}

function toLevelKey(name) {
  const n = (name || '').toLowerCase().trim();
  return LEVEL_KEY_MAP[n] || n.replace(/[^a-z0-9]/g, '');
}

function parseNum(v) {
  if (typeof v === 'number') return v;
  return parseInt(String(v).replace(/\s/g, '').replace(/[^0-9-]/g, '')) || 0;
}

// Execute fetch on the CRM tab (needs to be on web-lms.inter-nation.uz)
async function crmFetch(action, queryParams) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url || !tab.url.includes('web-lms.inter-nation.uz')) {
        reject(new Error('Please open web-lms.inter-nation.uz first!'));
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (action, queryParams) => {
          return fetch('/api/v1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              project: 'lms-v2',
              action: action,
              query_params: queryParams,
              enabled: true
            })
          }).then(r => r.json());
        },
        args: [action, queryParams]
      }, (results) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (results && results[0] && results[0].result) {
          resolve(results[0].result);
        } else {
          reject(new Error('No result from CRM'));
        }
      });
    });
  });
}

async function startFetch() {
  const btn = document.getElementById('fetchBtn');
  btn.disabled = true;
  document.getElementById('log').innerHTML = '';

  const month = document.getElementById('month').value;
  const yearOld = document.getElementById('yearOld').value;
  const yearNew = document.getElementById('yearNew').value;
  const regionIds = document.getElementById('regionIds').value.split(',').map(s => s.trim());
  const monthName = MONTH_NAMES[parseInt(month)];
  const monthKey = monthName.toLowerCase() + '-' + yearOld + '-vs-' + monthName.toLowerCase() + '-' + yearNew;
  const label = monthName + ' ' + yearOld + ' vs ' + monthName + ' ' + yearNew;

  // Date ranges for each year
  const lastDay = new Date(parseInt(yearOld), parseInt(month), 0).getDate();
  const fromOld = `${yearOld}-${month}-01`, toOld = `${yearOld}-${month}-${lastDay}`;
  const lastDayNew = new Date(parseInt(yearNew), parseInt(month), 0).getDate();
  const fromNew = `${yearNew}-${month}-01`, toNew = `${yearNew}-${month}-${lastDayNew}`;

  // Previous month for retention labels
  const prevIdx = parseInt(month) - 1 || 12;
  const prevMonthLabel = MONTH_NAMES[prevIdx];

  const data = {
    monthShort: monthName,
    yearOld: yearOld,
    yearNew: yearNew,
    label: label,
    prevMonthLabel: prevMonthLabel,
    branches: {}, newStudents: {}, levels: {}, ageGroups: {},
    retention: {}, leads: {}, leadsBranch: {}
  };

  try {
    setStatus('Fetching from CRM...', 'loading');

    // 1. STUDENT STATISTICS — branchShare for both years
    addLog('Fetching students by branch ' + yearOld + '...');
    const stOld = await crmFetch('admin_statistics_dashboard_statistics_student', {
      type: 'branchShare', year: yearOld, month: month, region_ids: regionIds
    });
    addLog('Fetching students by branch ' + yearNew + '...');
    const stNew = await crmFetch('admin_statistics_dashboard_statistics_student', {
      type: 'branchShare', year: yearNew, month: month, region_ids: regionIds
    });

    // Map branch data
    const oldBranches = {}, newBranches = {};
    const brList = (stOld && stOld.result) || stOld || [];
    const brArr = Array.isArray(brList) ? brList : (brList.branchShare || brList.list || []);
    brArr.forEach(b => { const k = toBranchKey(b.name || b.branch_name || b.label); if (k) oldBranches[k] = parseNum(b.value || b.count || b.total || 0); });
    const brListNew = (stNew && stNew.result) || stNew || [];
    const brArrNew = Array.isArray(brListNew) ? brListNew : (brListNew.branchShare || brListNew.list || []);
    brArrNew.forEach(b => { const k = toBranchKey(b.name || b.branch_name || b.label); if (k) newBranches[k] = parseNum(b.value || b.count || b.total || 0); });

    const allBranchKeys = new Set([...Object.keys(oldBranches), ...Object.keys(newBranches)]);
    allBranchKeys.forEach(k => {
      const o = oldBranches[k] || 0, n = newBranches[k] || 0;
      const name = brArrNew.find(b => toBranchKey(b.name || b.branch_name || b.label) === k)?.name
        || brArr.find(b => toBranchKey(b.name || b.branch_name || b.label) === k)?.name || k;
      data.branches[k] = { name, region: REGION_MAP[k] || 'tashkent', old: o, new: n, isNew: o === 0 && n > 0 };
    });
    addLog(`Branches: ${allBranchKeys.size} found`, 'ok');

    // 2. STUDENT STATISTICS — levelShare
    addLog('Fetching students by level ' + yearOld + '...');
    const lvOld = await crmFetch('admin_statistics_dashboard_statistics_student', {
      type: 'levelShare', year: yearOld, month: month, region_ids: regionIds
    });
    addLog('Fetching students by level ' + yearNew + '...');
    const lvNew = await crmFetch('admin_statistics_dashboard_statistics_student', {
      type: 'levelShare', year: yearNew, month: month, region_ids: regionIds
    });

    const parseLevels = (res) => {
      const arr = Array.isArray(res) ? res : (res?.result || res?.levelShare || res?.list || []);
      const m = {};
      (Array.isArray(arr) ? arr : []).forEach(l => {
        const k = toLevelKey(l.name || l.level_name || l.label);
        if (k) m[k] = parseNum(l.value || l.count || l.total || 0);
      });
      return m;
    };
    const lvOldMap = parseLevels(lvOld), lvNewMap = parseLevels(lvNew);
    const allLevels = new Set([...Object.keys(lvOldMap), ...Object.keys(lvNewMap)]);
    allLevels.forEach(k => {
      const nameMap = { beginner:'Beginner', elementary:'Elementary', preintermediate:'Pre-Intermediate', intermediate:'Intermediate', upperintermediate:'Upper-Intermediate', ielts:'IELTS' };
      data.levels[k] = { name: nameMap[k] || k, old: lvOldMap[k] || 0, new: lvNewMap[k] || 0 };
    });
    addLog(`Levels: ${allLevels.size} found`, 'ok');

    // 3. STUDENT STATISTICS — ageShare
    addLog('Fetching age data...');
    const ageOld = await crmFetch('admin_statistics_dashboard_statistics_student', {
      type: 'ageShare', year: yearOld, month: month, region_ids: regionIds
    });
    const ageNew = await crmFetch('admin_statistics_dashboard_statistics_student', {
      type: 'ageShare', year: yearNew, month: month, region_ids: regionIds
    });

    const parseAge = (res) => {
      const arr = Array.isArray(res) ? res : (res?.result || res?.ageShare || res?.list || []);
      const m = {};
      (Array.isArray(arr) ? arr : []).forEach(a => {
        const name = String(a.name || a.age || a.label || '').trim();
        const k = AGE_KEY_MAP[name] || 'age_' + name.replace(/[^0-9]/g, '_');
        m[k] = { name, value: parseNum(a.value || a.count || a.total || 0) };
      });
      return m;
    };
    const ageOldMap = parseAge(ageOld), ageNewMap = parseAge(ageNew);
    const allAges = new Set([...Object.keys(ageOldMap), ...Object.keys(ageNewMap)]);
    allAges.forEach(k => {
      data.ageGroups[k] = {
        name: (ageNewMap[k] || ageOldMap[k])?.name || k,
        old: ageOldMap[k]?.value || 0,
        new: ageNewMap[k]?.value || 0
      };
    });
    addLog(`Age groups: ${allAges.size} found`, 'ok');

    // 4. FRESHMAN & LOST (new students + retention)
    addLog('Fetching freshman & lost ' + yearOld + '...');
    const flOld = await crmFetch('admin_statistics_dashboard_statistics_freshman_lost', {
      year: yearOld, month: month, region_ids: regionIds
    });
    addLog('Fetching freshman & lost ' + yearNew + '...');
    const flNew = await crmFetch('admin_statistics_dashboard_statistics_freshman_lost', {
      year: yearNew, month: month, region_ids: regionIds
    });

    const parseFL = (res, key) => {
      const d = res?.result || res || {};
      const arr = d[key] || [];
      return Array.isArray(arr) ? arr : [];
    };

    // New students by branch (freshman)
    const fOldBr = parseFL(flOld, 'freshmanBranch'), fNewBr = parseFL(flNew, 'freshmanBranch');
    const fOldMap = {}, fNewMap = {};
    fOldBr.forEach(b => { fOldMap[toBranchKey(b.name || b.branch_name || b.label)] = parseNum(b.value || b.count || 0); });
    fNewBr.forEach(b => { fNewMap[toBranchKey(b.name || b.branch_name || b.label)] = parseNum(b.value || b.count || 0); });
    const allNsBranches = new Set([...Object.keys(fOldMap), ...Object.keys(fNewMap)]);
    allNsBranches.forEach(k => {
      const o = fOldMap[k] || 0, n = fNewMap[k] || 0;
      const name = data.branches[k]?.name || k;
      data.newStudents[k] = { name, old: o, new: n, isNew: o === 0 && n > 0 };
    });
    addLog(`New students: ${allNsBranches.size} branches`, 'ok');

    // Lost by level (retention)
    const lOldLv = parseFL(flOld, 'lostLevel'), lNewLv = parseFL(flNew, 'lostLevel');
    const lOldMap = {}, lNewMap = {};
    lOldLv.forEach(l => { lOldMap[toLevelKey(l.name || l.level_name || l.label)] = parseNum(l.value || l.count || 0); });
    lNewLv.forEach(l => { lNewMap[toLevelKey(l.name || l.level_name || l.label)] = parseNum(l.value || l.count || 0); });

    // For retention we need "previous month students" — use level totals as proxy
    Object.keys(data.levels).forEach(k => {
      data.retention[k] = {
        name: data.levels[k].name,
        prevOld: data.levels[k].old || 0,
        lostOld: lOldMap[k] || 0,
        prevNew: data.levels[k].new || 0,
        lostNew: lNewMap[k] || 0
      };
    });
    addLog('Retention data mapped', 'ok');

    // 5. LEAD STATISTICS
    addLog('Fetching leads ' + yearOld + '...');
    const ldOld = await crmFetch('admin_statistics_dashboard_statistics_lead', {
      from_date: fromOld, to_date: toOld, region_ids: regionIds
    });
    addLog('Fetching leads ' + yearNew + '...');
    const ldNew = await crmFetch('admin_statistics_dashboard_statistics_lead', {
      from_date: fromNew, to_date: toNew, region_ids: regionIds
    });

    const parseLd = (res, key) => {
      const d = res?.result || res || {};
      return Array.isArray(d[key]) ? d[key] : [];
    };

    // Leads by level
    const ldOldLv = parseLd(ldOld, 'leadByLevel'), ldNewLv = parseLd(ldNew, 'leadByLevel');
    const ldOldLvMap = {}, ldNewLvMap = {};
    ldOldLv.forEach(l => { ldOldLvMap[toLevelKey(l.name || l.level_name || l.label)] = parseNum(l.value || l.count || 0); });
    ldNewLv.forEach(l => { ldNewLvMap[toLevelKey(l.name || l.level_name || l.label)] = parseNum(l.value || l.count || 0); });
    const allLeadLevels = new Set([...Object.keys(ldOldLvMap), ...Object.keys(ldNewLvMap)]);
    allLeadLevels.forEach(k => {
      const nameMap = { beginner:'Beginner', elementary:'Elementary', preintermediate:'Pre-Intermediate', intermediate:'Intermediate', upperintermediate:'Upper-Intermediate', ielts:'IELTS' };
      data.leads[k] = { name: nameMap[k] || k, old: ldOldLvMap[k] || 0, new: ldNewLvMap[k] || 0 };
    });

    // Leads by branch
    const ldOldBr = parseLd(ldOld, 'leadByBranch'), ldNewBr = parseLd(ldNew, 'leadByBranch');
    const ldOldBrMap = {}, ldNewBrMap = {};
    ldOldBr.forEach(b => { ldOldBrMap[toBranchKey(b.name || b.branch_name || b.label)] = parseNum(b.value || b.count || 0); });
    ldNewBr.forEach(b => { ldNewBrMap[toBranchKey(b.name || b.branch_name || b.label)] = parseNum(b.value || b.count || 0); });
    const allLeadBranches = new Set([...Object.keys(ldOldBrMap), ...Object.keys(ldNewBrMap)]);
    allLeadBranches.forEach(k => {
      const o = ldOldBrMap[k] || 0, n = ldNewBrMap[k] || 0;
      const name = data.branches[k]?.name || k;
      data.leadsBranch[k] = { name, old: o, new: n, isNew: o === 0 && n > 0 };
    });
    addLog(`Leads: ${allLeadLevels.size} levels, ${allLeadBranches.size} branches`, 'ok');

    // 6. SAVE TO FIREBASE
    addLog('Saving to Firebase...');
    setStatus('Saving to Firebase...', 'loading');

    await db.ref('months/' + monthKey).set(data);
    await db.ref('config/availableMonths/' + monthKey).set({
      label: label,
      order: parseInt(yearNew) * 100 + parseInt(month)
    });
    await db.ref('config/currentMonth').set(monthKey);

    addLog('Saved to Firebase!', 'ok');
    setStatus('Done! Data synced to dashboard.', 'ok');
    addLog(`Month key: ${monthKey}`);
    addLog(`Branches: ${Object.keys(data.branches).length}`);
    addLog(`Levels: ${Object.keys(data.levels).length}`);
    addLog(`Age groups: ${Object.keys(data.ageGroups).length}`);
    addLog(`New students: ${Object.keys(data.newStudents).length}`);
    addLog(`Retention: ${Object.keys(data.retention).length}`);
    addLog(`Leads levels: ${Object.keys(data.leads).length}`);
    addLog(`Leads branches: ${Object.keys(data.leadsBranch).length}`);

  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
    addLog('ERROR: ' + err.message, 'err');
    console.error(err);
  }

  btn.disabled = false;
}
