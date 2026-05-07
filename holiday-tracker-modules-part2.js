// ════════════════════════════════════════════════════════════════════════════
// GANTT RENDER MODULE
// ════════════════════════════════════════════════════════════════════════════
window.GanttRenderModule = (() => {
  const { state, CONSTANTS } = window.CoreModule;
  const { dateStr, parseDate } = window.UtilsModule;

  const render = () => {
    document.getElementById('monthLabel').textContent = `${CONSTANTS.MONTHS_SHORT[state.viewMonth]} ${state.viewYear} — Timeline`;

    const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
    const today = dateStr(new Date());
    const mPad = String(state.viewMonth + 1).padStart(2, '0');

    let html = `<div class="gantt-header-row"><div class="gantt-name-col">Person</div><div class="gantt-days-header">`;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${state.viewYear}-${mPad}-${String(d).padStart(2, '0')}`;
      const dow = parseDate(iso).getDay();
      html += `<div class="gantt-day-label${iso===today?' today-col':''}${dow===0||dow===6?' weekend-col':''}">${d}</div>`;
    }
    html += `</div></div>`;

    state.people.forEach(p => {
      const color = window.UtilsModule.getColor(p.id);
      let cells = '';
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${state.viewYear}-${mPad}-${String(d).padStart(2,'0')}`;
        const dow = parseDate(iso).getDay();
        cells += `<div class="gantt-cell${iso===today?' today-col':''}${dow===0||dow===6?' weekend':''}"></div>`;
      }
      const mStart = `${state.viewYear}-${mPad}-01`;
      const mEnd = `${state.viewYear}-${mPad}-${String(daysInMonth).padStart(2, '0')}`;
      let bars = '';
      state.holidays.filter(h => h.personId === p.id).forEach(h => {
        const clipStart = h.start < mStart ? mStart : h.start;
        const clipEnd = h.end > mEnd ? mEnd : h.end;
        if (clipStart > clipEnd) return;
        const startDay = parseInt(clipStart.split('-')[2]) - 1;
        const endDay = parseInt(clipEnd.split('-')[2]) - 1;
        const left = (startDay / daysInMonth) * 100;
        const width = ((endDay - startDay + 1) / daysInMonth) * 100;
        const icon = CONSTANTS.LEAVE_TYPE_ICONS[h.type] || '📌';
        bars += `<div class="gantt-bar" style="left:${left}%;width:${width}%;background:${color.bg};" title="${icon} ${h.type} · ${dateStr(h.start)} → ${dateStr(h.end)}${h.note?' · '+h.note:''}">${width > 8 ? icon : ''}</div>`;
      });
      html += `<div class="gantt-person-row"><div class="gantt-person-name">${p.name.split(' ')[0]}</div><div class="gantt-cells" style="position:relative;">${cells}${bars}</div></div>`;
    });

    document.getElementById('ganttGrid').innerHTML = html;
  };

  return { render };
})();

// ════════════════════════════════════════════════════════════════════════════
// VACATION BALANCE RENDER MODULE
// ════════════════════════════════════════════════════════════════════════════
window.VacBalanceModule = (() => {
  const { state, CONSTANTS } = window.CoreModule;
  const { vacAllotment, vacUsedByYear } = window.VacationModule;
  const { fmtDays, getColor, initials } = window.UtilsModule;

  const render = () => {
    const year = state.viewYear;
    document.getElementById('vacYearTag').textContent = year;
    const list = document.getElementById('vacBalanceList');
    if (!state.people.length) { list.innerHTML = '<div class="empty-state">No team members yet</div>'; return; }

    list.innerHTML = state.people.map(p => {
      const color = getColor(p.id);
      const allot = vacAllotment(p.id, year);
      const used = vacUsedByYear(p.id, year);
      const remaining = allot - used;
      const pct = Math.max(0, Math.min(100, (remaining / allot) * 100));
      let remainClass = 'ok', barColor = '#6ee7b7';
      if (remaining <= 0) { remainClass = 'exhausted'; barColor = '#f87171'; }
      else if (remaining <= 3) { remainClass = 'warn'; barColor = '#f59e0b'; }
      const bonusBadge = allot > CONSTANTS.VACATION_DAYS_PER_YEAR
        ? `<span style="font-family:'DM Mono',monospace;font-size:0.58rem;color:var(--accent3);margin-left:3px;">+${allot-CONSTANTS.VACATION_DAYS_PER_YEAR}↩</span>` : '';
      const resetBtn = window.CoreModule.isAdmin()
        ? `<button class="reset-vac-btn" onclick="window.AdminModule.resetVacation('${p.id}','${p.name}',${year})" title="Reset vacation balance">↺</button>` : '';
      return `<div class="vac-row">
        <div class="avatar" style="width:30px;height:30px;font-size:0.65rem;background:${color.bg};color:${color.text};">${initials(p.name)}</div>
        <div class="vac-info">
          <div class="vac-name">${p.name}</div>
          <div style="display:flex;align-items:center;gap:4px;">
            <div class="vac-dept">${p.dept}</div>
            <div class="vac-bar-wrap" style="flex:1;max-width:60px;"><div class="vac-bar" style="width:${pct}%;background:${barColor};"></div></div>
            <div class="vac-dept">${fmtDays(used)}/${allot}d used</div>
          </div>
        </div>
        <div class="vac-right">
          <div class="vac-counter"><span class="vac-remaining ${remainClass}">${fmtDays(remaining)}</span><span class="vac-of">left${bonusBadge}</span></div>
          ${resetBtn}
        </div>
      </div>`;
    }).join('');
  };

  return { render };
})();

// ════════════════════════════════════════════════════════════════════════════
// AWAY MODULE
// ════════════════════════════════════════════════════════════════════════════
window.AwayModule = (() => {
  const { state, CONSTANTS } = window.CoreModule;
  const { dateStr } = window.UtilsModule;
  const { holidaysOnDate } = window.VacationModule;

  const render = () => {
    const today = dateStr(new Date());
    const away = holidaysOnDate(today);
    document.getElementById('awayCount').textContent = away.length;
    const list = document.getElementById('awayList');
    if (!away.length) { list.innerHTML = '<div class="empty-state">No one is away today ✓</div>'; return; }
    list.innerHTML = away.map(h => {
      const p = window.UtilsModule.getPerson(h.personId);
      if (!p) return '';
      const color = window.UtilsModule.getColor(h.personId);
      return `<div class="person-row">
        <div class="avatar" style="background:${color.bg};color:${color.text};">${window.UtilsModule.initials(p.name)}</div>
        <div class="person-info"><div class="person-name">${p.name}</div><div class="person-dept">${p.dept}</div></div>
        <span class="leave-badge chip" style="background:var(--accent-a08);color:var(--accent);">${CONSTANTS.LEAVE_TYPE_ICONS[h.type]||'📌'}${h.halfDay?' ½':''}</span>
      </div>`;
    }).join('');
  };

  return { render };
})();

// ════════════════════════════════════════════════════════════════════════════
// ALL LIST MODULE
// ════════════════════════════════════════════════════════════════════════════
window.AllListModule = (() => {
  const { state, CONSTANTS } = window.CoreModule;
  const { dateStr, fmtDays } = window.UtilsModule;
  const { entryDays } = window.VacationModule;
  const { canDelete } = window.CoreModule;

  const render = () => {
    const sorted = [...state.holidays].sort((a, b) => a.start.localeCompare(b.start));
    document.getElementById('allCount').textContent = sorted.length;
    const list = document.getElementById('allList');
    if (!sorted.length) { list.innerHTML = '<div class="empty-state">No holidays recorded yet</div>'; return; }
    list.innerHTML = sorted.map(h => {
      const p = window.UtilsModule.getPerson(h.personId);
      if (!p) return '';
      const color = window.UtilsModule.getColor(h.personId);
      const halfTag = h.halfDay ? ` · ½ ${h.halfDayPart||''}` : '';
      const days = entryDays(h);
      const del = canDelete(h)
        ? `<button class="delete-btn" onclick="window.HolidayModule.delete('${h.id}')" title="Delete">✕</button>` : '';
      return `<div class="list-item-row">
        <div class="avatar" style="width:30px;height:30px;background:${color.bg};color:${color.text};font-size:0.65rem;">${window.UtilsModule.initials(p.name)}</div>
        <div class="list-item-info">
          <div class="list-item-name">${p.name} ${CONSTANTS.LEAVE_TYPE_ICONS[h.type]||'📌'}<span style="font-family:'DM Mono',monospace;font-size:0.6rem;color:var(--text-muted);margin-left:4px;">${fmtDays(days)}d</span></div>
          <div class="list-item-date">${dateStr(h.start)} → ${dateStr(h.end)}${halfTag}${h.note?' · '+h.note:''}</div>
        </div>
        ${del}
      </div>`;
    }).join('');
  };

  return { render };
})();

// ════════════════════════════════════════════════════════════════════════════
// LEGEND MODULE
// ════════════════════════════════════════════════════════════════════════════
window.LegendModule = (() => {
  const { state } = window.CoreModule;
  const { getColor, initials } = window.UtilsModule;

  const render = () => {
    const pubHolLegend = state.publicHolidays.length ? `<div class="legend-item"><div class="legend-dot" style="background:var(--accent3)"></div>Public Holiday</div>` : '';
    document.getElementById('legend').innerHTML =
      state.people.map(p => {
        const color = getColor(p.id);
        return `<div class="legend-item"><div class="legend-dot" style="background:${color.bg}"></div>${p.name.split(' ')[0]}</div>`;
      }).join('') +
      pubHolLegend +
      `<div class="legend-item"><div class="legend-dot" style="background:var(--surface3);border:1px solid var(--border);"></div>Weekend (not counted)</div>`;
  };

  return { render };
})();

// ════════════════════════════════════════════════════════════════════════════
// SEARCH MODULE
// ════════════════════════════════════════════════════════════════════════════
window.SearchModule = (() => {
  const { state, CONSTANTS } = window.CoreModule;
  const { dateStr, fmtDate, getColor, initials } = window.UtilsModule;
  const { holidaysOnDate, publicHolOnDate } = window.VacationModule;

  const searchByDate = () => {
    const val = document.getElementById('searchDate').value;
    const res = document.getElementById('searchResults');
    if (!val) { res.innerHTML = ''; return; }
    const hs = holidaysOnDate(val);
    const pubHol = publicHolOnDate(val);
    let html = '';
    if (pubHol) html += `<div class="search-result-item" style="border-color:var(--accent3-a25);">
      <div class="result-avatar" style="background:var(--accent3-a12);color:var(--accent3);">🗓</div>
      <div class="result-info"><div class="result-name">${pubHol.name}</div><div class="result-dates">Public Holiday</div></div>
    </div>`;
    if (!hs.length && !pubHol) { res.innerHTML = '<div class="no-results">No one on leave this day</div>'; return; }
    html += hs.map(h => {
      const p = window.UtilsModule.getPerson(h.personId);
      if (!p) return '';
      const color = getColor(h.personId);
      return `<div class="search-result-item">
        <div class="result-avatar" style="background:${color.bg};color:${color.text};">${initials(p.name)}</div>
        <div class="result-info">
          <div class="result-name">${p.name} ${CONSTANTS.LEAVE_TYPE_ICONS[h.type]||'📌'}${h.halfDay?' ½'+h.halfDayPart:''}</div>
          <div class="result-dates">${fmtDate(h.start)} → ${fmtDate(h.end)}${h.note?' · '+h.note:''}</div>
        </div>
      </div>`;
    }).join('');
    res.innerHTML = html;
  };

  return { searchByDate };
})();

// ════════════════════════════════════════════════════════════════════════════
// PROFILE MODULE
// ════════════════════════════════════════════════════════════════════════════
window.ProfileModule = (() => {
  const { state, collections } = window.CoreModule;
  const { showToast } = window.UIModule;
  const { getColor, initials } = window.UtilsModule;

  const updateChip = () => {
    if (!state.currentUser) return;
    const color = getColor(state.currentUser.personId);
    const av = document.getElementById('userChipAvatar');
    av.style.background = color.bg;
    av.style.color = color.text;
    av.textContent = initials(state.currentUser.displayName);
    document.getElementById('userChipName').textContent = state.currentUser.displayName.split(' ')[0];
    document.getElementById('userChipCrown').style.display = state.currentUser.isAdmin ? 'inline' : 'none';
  };

  const updateAdminUI = () => {
    const admin = window.CoreModule.isAdmin();
    document.getElementById('pubHolBtn').style.display = admin ? '' : 'none';
    document.getElementById('manageBtn').style.display = admin ? '' : 'none';
  };

  const openModal = () => {
    document.getElementById('profileTitle').textContent = state.currentUser.displayName;
    document.getElementById('profileSub').textContent = state.currentUser.isAdmin ? '👑 Admin' : 'Team member';
    document.getElementById('newPw1').value = '';
    document.getElementById('newPw2').value = '';
    const err = document.getElementById('pwChangeError');
    err.textContent = ''; err.classList.remove('show');
    document.getElementById('profileModal').classList.add('open');
  };

  const closeModal = () => {
    document.getElementById('profileModal').classList.remove('open');
  };

  const signOut = () => {
    closeModal();
    window.AuthModule.clearSession();
    showAuthGate();
    showToast('Signed out.');
  };

  const changePassword = async () => {
    const pw1 = document.getElementById('newPw1').value;
    const pw2 = document.getElementById('newPw2').value;
    const err = document.getElementById('pwChangeError');
    err.textContent = ''; err.classList.remove('show');
    if (!pw1) { err.textContent = 'Enter a new password.'; err.classList.add('show'); return; }
    if (pw1.length < 6) { err.textContent = 'Min 6 characters.'; err.classList.add('show'); return; }
    if (pw1 !== pw2) { err.textContent = 'Passwords do not match.'; err.classList.add('show'); return; }
    try {
      const hash = await window.AuthModule.hashPassword(pw1);
      await collections.userProfs.doc(state.currentUser.uid).update({ passwordHash: hash });
      closeModal();
      showToast('Password updated!');
    } catch(e) { err.textContent = e.message; err.classList.add('show'); }
  };

  return { updateChip, updateAdminUI, openModal, closeModal, signOut, changePassword };
})();

// ════════════════════════════════════════════════════════════════════════════
// ADMIN MODULE
// ════════════════════════════════════════════════════════════════════════════
window.AdminModule = (() => {
  const { state, collections, CONSTANTS } = window.CoreModule;
  const { showToast } = window.UIModule;
  const { getColor, initials, getPerson } = window.UtilsModule;
  const { VACATION_DAYS_PER_YEAR } = CONSTANTS;

  const openPublicHolidays = () => {
    if (!window.CoreModule.isAdmin()) { showToast('Admin only.', true); return; }
    renderPubHolList();
    document.getElementById('pubHolModal').classList.add('open');
  };

  const closePubHol = () => {
    document.getElementById('pubHolModal').classList.remove('open');
  };

  const renderPubHolList = () => {
    const list = document.getElementById('pubHolList');
    if (!state.publicHolidays.length) { list.innerHTML = '<div class="empty-state">No public holidays added yet</div>'; return; }
    list.innerHTML = state.publicHolidays.map(ph =>
      `<div class="pub-hol-item">
        <span style="font-family:'DM Mono',monospace;font-size:0.75rem;color:var(--text-dim);flex:0 0 110px;">${window.UtilsModule.fmtDate(ph.date)}</span>
        <span style="font-size:0.82rem;flex:1;">${ph.name}</span>
        <button class="delete-btn" onclick="window.AdminModule.deletePublicHoliday('${ph.id}')" title="Remove">✕</button>
      </div>`
    ).join('');
  };

  const addPublicHoliday = async () => {
    if (!window.CoreModule.isAdmin()) { showToast('Admin only.', true); return; }
    const date = document.getElementById('newPubDate').value;
    const name = document.getElementById('newPubName').value.trim();
    if (!date || !name) { showToast('Enter date and name.', true); return; }
    window.UIModule.showSaving(true);
    try {
      await collections.pubHols.add({ date, name, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      document.getElementById('newPubDate').value = '';
      document.getElementById('newPubName').value = '';
      renderPubHolList();
      showToast('Public holiday added!');
    } catch(e) { showToast('Failed: '+e.message, true); }
    finally { window.UIModule.showSaving(false); }
  };

  const deletePublicHoliday = async id => {
    if (!window.CoreModule.isAdmin()) { showToast('Admin only.', true); return; }
    window.UIModule.showSaving(true);
    try {
      await collections.pubHols.doc(id).delete();
      renderPubHolList();
      showToast('Removed.');
    } catch(e) { showToast('Failed: '+e.message, true); }
    finally { window.UIModule.showSaving(false); }
  };

  const resetVacation = async (personId, personName, year) => {
    if (!window.CoreModule.isAdmin()) { showToast('Admin only.', true); return; }
    const existing = state.vacResets.find(r => r.personId === personId && r.year === year);
    const currentBonus = existing ? (existing.resetDays || 0) : 0;
    const newBonus = currentBonus + VACATION_DAYS_PER_YEAR;
    if (!confirm(`Reset vacation for ${personName}?\n\nAdds ${VACATION_DAYS_PER_YEAR} days to ${year} allotment.\n${VACATION_DAYS_PER_YEAR+currentBonus} → ${VACATION_DAYS_PER_YEAR+newBonus} days`)) return;
    window.UIModule.showSaving(true);
    try {
      await collections.vacResets.doc(`${personId}_${year}`).set({ personId, year, resetDays: newBonus, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      await window.LogModule.writeLog('vac_reset', `<strong>${personName}</strong> — vacation balance reset (+${VACATION_DAYS_PER_YEAR} days for ${year})`, { personId, year, newBonus });
      showToast(`+${VACATION_DAYS_PER_YEAR} days added for ${personName} in ${year}`);
    } catch(e) { showToast('Reset failed: '+e.message, true); }
    finally { window.UIModule.showSaving(false); }
  };

  const openManage = () => {
    if (!window.CoreModule.isAdmin()) { showToast('Admin only.', true); return; }
    renderPeopleList();
    document.getElementById('manageModal').classList.add('open');
  };

  const closeManage = () => {
    document.getElementById('manageModal').classList.remove('open');
  };

  const renderPeopleList = () => {
    const list = document.getElementById('peopleList');
    if (!state.people.length) { list.innerHTML = '<div class="empty-state">No people added yet</div>'; return; }
    list.innerHTML = state.people.map(p => {
      const color = getColor(p.id);
      const prof = state.userProfiles.find(u => u.personId === p.id);
      let badge = '';
      if (prof && prof.isAdmin) badge = `<span class="account-badge admin">👑 admin</span>`;
      else if (prof) badge = `<span class="account-badge linked">✓ account</span>`;
      else badge = `<span class="account-badge unlinked">no account</span>`;
      const toggleAdmin = prof
        ? `<button class="btn btn-sm btn-ghost" onclick="window.AdminModule.toggleAdminStatus('${prof.uid}','${p.name}',${!!prof.isAdmin})" style="padding:4px 8px;font-size:0.65rem;">${prof.isAdmin?'↓':'↑'}admin</button>`
        : '';
      return `<div class="list-item-row" style="flex-wrap:wrap;gap:6px;">
        <div class="avatar" style="width:30px;height:30px;background:${color.bg};color:${color.text};font-size:0.65rem;">${initials(p.name)}</div>
        <div class="list-item-info"><div class="list-item-name">${p.name}</div><div class="list-item-date">${p.dept}</div></div>
        ${badge}${toggleAdmin}
        <button class="delete-btn" onclick="window.AdminModule.removePerson('${p.id}')" title="Remove">✕</button>
      </div>`;
    }).join('');
  };

  const addPerson = async () => {
    if (!window.CoreModule.isAdmin()) { showToast('Admin only.', true); return; }
    const name = document.getElementById('newPersonName').value.trim();
    const dept = document.getElementById('newPersonDept').value.trim() || 'Team';
    if (!name) { showToast('Enter a name.', true); return; }
    window.UIModule.showSaving(true);
    try {
      await collections.people.add({ name, dept, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      await window.LogModule.writeLog('person_add', `<strong>${name}</strong> added to team (${dept})`, { name, dept });
      document.getElementById('newPersonName').value = '';
      document.getElementById('newPersonDept').value = '';
      showToast('Person added!');
      renderPeopleList();
    } catch(e) { showToast('Failed: '+e.message, true); }
    finally { window.UIModule.showSaving(false); }
  };

  const removePerson = async id => {
    if (!window.CoreModule.isAdmin()) { showToast('Admin only.', true); return; }
    if (!confirm('Remove this person and all their holidays?')) return;
    window.UIModule.showSaving(true);
    try {
      const [snap, resetSnap] = await Promise.all([
        collections.holidays.where('personId','==',id).get(),
        collections.vacResets.where('personId','==',id).get()
      ]);
      const batch = state.db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      resetSnap.docs.forEach(d => batch.delete(d.ref));
      batch.delete(collections.people.doc(id));
      const removedPerson = state.people.find(p => p.id === id);
      await batch.commit();
      if (removedPerson) {
        await window.LogModule.writeLog('person_remove', `<strong>${removedPerson.name}</strong> removed from team (${removedPerson.dept})`, { name: removedPerson.name });
      }
      renderPeopleList();
      showToast('Person removed.');
    } catch(e) { showToast('Failed: '+e.message, true); }
    finally { window.UIModule.showSaving(false); }
  };

  const toggleAdminStatus = async (uid, personName, currentlyAdmin) => {
    if (!window.CoreModule.isAdmin()) { showToast('Admin only.', true); return; }
    if (currentlyAdmin && uid === state.currentUser.uid) { showToast("Can't remove your own admin status.", true); return; }
    if (!confirm(`${currentlyAdmin ? 'Remove' : 'Grant'} admin for ${personName}?`)) return;
    window.UIModule.showSaving(true);
    try {
      await collections.userProfs.doc(uid).update({ isAdmin: !currentlyAdmin });
      showToast(`${personName} is ${!currentlyAdmin ? 'now an admin' : 'no longer admin'}.`);
      renderPeopleList();
    } catch(e) { showToast('Failed: '+e.message, true); }
    finally { window.UIModule.showSaving(false); }
  };

  return {
    openPublicHolidays, closePubHol, addPublicHoliday, deletePublicHoliday,
    resetVacation, openManage, closeManage, addPerson, removePerson, toggleAdminStatus
  };
})();

// ════════════════════════════════════════════════════════════════════════════
// EXPORT MODULE
// ════════════════════════════════════════════════════════════════════════════
window.ExportModule = (() => {
  const { state } = window.CoreModule;
  const { showToast } = window.UIModule;
  const { dateStr, fmtDays } = window.UtilsModule;
  const { entryDays } = window.VacationModule;

  const exportCSV = () => {
    if (!state.holidays.length) { showToast('No entries to export.', true); return; }
    const headers = ['Name','Department','Type','Start','End','Weekdays','Half Day','Note'];
    const rows = state.holidays.map(h => {
      const p = window.UtilsModule.getPerson(h.personId);
      return [
        p ? p.name : 'Unknown',
        p ? p.dept : '',
        h.type,
        h.start,
        h.end,
        fmtDays(entryDays(h)),
        h.halfDay ? (h.halfDayPart || 'yes') : '',
        (h.note || '').replace(/,/g, ';')
      ];
    });
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `holidays_${dateStr(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported!');
  };

  return { exportCSV };
})();

// ════════════════════════════════════════════════════════════════════════════
// FIREBASE LISTENERS MODULE
// ════════════════════════════════════════════════════════════════════════════
window.FirebaseListenersModule = (() => {
  const { state, collections, bustCaches } = window.CoreModule;
  const { setStatus } = window.UIModule;

  const startAll = () => {
    setStatus('', 'Connecting...');

    collections.people.orderBy('name').onSnapshot(snap => {
      state.people = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      bustCaches();
      window.CoreModule.scheduleRender();
      setStatus('online', 'Online');
      if (document.getElementById('manageModal').classList.contains('open')) window.AdminModule.renderPeopleList();
    }, err => { setStatus('error', 'Error'); window.UIModule.showToast('Connection error: ' + err.message, true); });

    collections.holidays.orderBy('start').onSnapshot(snap => {
      state.holidays = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      bustCaches();
      window.CoreModule.scheduleRender();
    }, err => { window.UIModule.showToast('Sync error: ' + err.message, true); });

    collections.vacResets.onSnapshot(snap => {
      state.vacResets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      bustCaches();
      window.CoreModule.scheduleRender();
    }, () => {});

    collections.pubHols.orderBy('date').onSnapshot(snap => {
      state.publicHolidays = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      bustCaches();
      window.CoreModule.scheduleRender();
    }, () => {});

    collections.userProfs.onSnapshot(snap => {
      state.userProfiles = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      if (document.getElementById('manageModal').classList.contains('open')) window.AdminModule.renderPeopleList();
    }, () => {});
  };

  return { startAll };
})();

// ════════════════════════════════════════════════════════════════════════════
// MODAL BACKDROP HANDLER
// ════════════════════════════════════════════════════════════════════════════
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

// ════════════════════════════════════════════════════════════════════════════
// HASH PASSWORD (needed for auth module)
// ════════════════════════════════════════════════════════════════════════════
window.AuthModule.hashPassword = async pw => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw + 'grimoire_salt'));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};

console.log('✓ All modules loaded successfully');
