/* ========================================
   ARIA — AI Personal Assistant
   Application Logic
   ======================================== */

(function () {
  'use strict';

  // ==========================================
  // Configuration
  // ==========================================
  const CONFIG = {
    webhookUrl: '/api/answer',
    userId: 'ben10_user_001',
    assistantName: 'ARIA',
    version: '2.0',
    simulateResponses: false,
  };

  // ==========================================
  // DOM References
  // ==========================================
  const DOM = {
    app: document.getElementById('app'),
    chatArea: document.getElementById('chat-area'),
    welcomeScreen: document.getElementById('welcome-screen'),
    messagesContainer: document.getElementById('messages-container'),
    messageInput: document.getElementById('message-input'),
    sendBtn: document.getElementById('send-btn'),
    inputWrapper: document.getElementById('input-wrapper'),
    menuToggle: document.getElementById('menu-toggle'),
    sidebar: document.getElementById('sidebar'),
    greetingText: document.getElementById('greeting-text'),
    statusIndicator: document.getElementById('status-indicator'),
    quickActions: document.getElementById('quick-actions'),
    toastContainer: document.getElementById('toast-container'),
    insightStreak: document.getElementById('insight-streak'),
    insightProductivity: document.getElementById('insight-productivity'),
    insightTasks: document.getElementById('insight-tasks'),
    navItems: document.querySelectorAll('.nav-item'),
  };

  // ==========================================
  // State
  // ==========================================
  let state = {
    messages: [],
    isLoading: false,
    currentIntent: 'general',
    sidebarOpen: false,
    insights: null,
  };

  // ==========================================
  // Initialization
  // ==========================================
  function init() {
    setGreeting();
    bindEvents();
    autoResizeTextarea();
    checkWebhookConfig();
  }

  function setGreeting() {
    const hour = new Date().getHours();
    let greeting;
    if (hour < 12) greeting = '☀️ Good Morning';
    else if (hour < 17) greeting = '🌤️ Good Afternoon';
    else greeting = '🌙 Good Evening';
    DOM.greetingText.textContent = greeting;
  }

  function checkWebhookConfig() {
    if (!CONFIG.webhookUrl) {
      CONFIG.simulateResponses = true;
    }
  }

  // ==========================================
  // Event Bindings
  // ==========================================
  function bindEvents() {
    // Send message
    DOM.sendBtn.addEventListener('click', handleSend);
    DOM.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Input state
    DOM.messageInput.addEventListener('input', () => {
      const hasText = DOM.messageInput.value.trim().length > 0;
      DOM.sendBtn.classList.toggle('active', hasText);
      autoResizeTextarea();
    });

    // Quick actions
    DOM.quickActions.addEventListener('click', (e) => {
      const btn = e.target.closest('.quick-action-btn');
      if (btn) {
        const message = btn.dataset.message;
        DOM.messageInput.value = message;
        DOM.sendBtn.classList.add('active');
        handleSend();
      }
    });

    // Sidebar nav
    DOM.navItems.forEach((item) => {
      item.addEventListener('click', () => {
        DOM.navItems.forEach((n) => n.classList.remove('active'));
        item.classList.add('active');
        state.currentIntent = item.dataset.intent;
        closeSidebar();
      });
    });

    // Mobile menu
    DOM.menuToggle.addEventListener('click', toggleSidebar);

    // Suggestion chips (delegated)
    DOM.messagesContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.suggestion-chip');
      if (chip) {
        const text = chip.textContent.trim();
        DOM.messageInput.value = text;
        DOM.sendBtn.classList.add('active');
        handleSend();
      }
    });
  }

  function autoResizeTextarea() {
    DOM.messageInput.style.height = 'auto';
    DOM.messageInput.style.height = Math.min(DOM.messageInput.scrollHeight, 120) + 'px';
  }

  // ==========================================
  // Sidebar
  // ==========================================
  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    DOM.sidebar.classList.toggle('open', state.sidebarOpen);

    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      overlay.addEventListener('click', closeSidebar);
      document.body.appendChild(overlay);
    }
    overlay.classList.toggle('active', state.sidebarOpen);
  }

  function closeSidebar() {
    state.sidebarOpen = false;
    DOM.sidebar.classList.remove('open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.classList.remove('active');
  }

  // ==========================================
  // Message Handling
  // ==========================================
  async function handleSend() {
    const text = DOM.messageInput.value.trim();
    if (!text || state.isLoading) return;

    // Hide welcome screen
    if (DOM.welcomeScreen) {
      DOM.welcomeScreen.style.display = 'none';
    }

    // Add user message
    addMessage('user', text);
    DOM.messageInput.value = '';
    DOM.sendBtn.classList.remove('active');
    autoResizeTextarea();

    // Show loading
    setLoading(true);
    const loadingEl = addTypingIndicator();

    try {
      let response;
      if (CONFIG.simulateResponses || !CONFIG.webhookUrl) {
        response = await simulateResponse(text);
      } else {
        response = await sendToWebhook(text);
      }

      // Remove typing indicator
      loadingEl.remove();
      setLoading(false);

      // Add assistant response
      renderAssistantResponse(response);

      // Update insights
      if (response.user_insights) {
        updateInsights(response.user_insights);
      }
    } catch (error) {
      loadingEl.remove();
      setLoading(false);
      showToast('Failed to get response. Please try again.', 'error');
      console.error('ARIA Error:', error);
    }
  }

  async function sendToWebhook(message) {
    const res = await fetch(CONFIG.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: message,
        assets: [],
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return normalizeApiResponse(message, data);
  }

  function normalizeApiResponse(message, data) {
    if (data && data.ai_response) return data;

    return {
      success: true,
      assistant_name: CONFIG.assistantName,
      version: CONFIG.version,
      session_id: `session_${CONFIG.userId}_${Date.now()}`,
      user_id: CONFIG.userId,
      timestamp: new Date().toISOString(),
      intent: 'general',
      original_message: message,
      ai_response: {
        response: data?.output || 'No response returned.',
        intent_detected: 'general',
      },
      metadata: {
        processing_time_ms: 0,
        model_used: 'api',
        team: 'Team Ben10',
      },
    };
  }

  // ==========================================
  // Simulated Responses
  // ==========================================
  async function simulateResponse(message) {
    // Simulate network delay
    await new Promise((r) => setTimeout(r, 1200 + Math.random() * 800));

    const msg = message.toLowerCase();
    let intent = 'general';
    if (msg.includes('remind') || msg.includes('reminder')) intent = 'reminder';
    else if (msg.includes('schedule') || msg.includes('meeting') || msg.includes('calendar')) intent = 'schedule';
    else if (msg.includes('task') || msg.includes('todo') || msg.includes('to-do')) intent = 'task';
    else if (msg.includes('summary') || msg.includes('summarize') || msg.includes('daily') || msg.includes('plan')) intent = 'summary';
    else if (msg.includes('motivat') || msg.includes('quote') || msg.includes('inspiration')) intent = 'motivation';

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

    const responses = {
      reminder: {
        reminder_title: extractReminderTitle(message),
        reminder_time: extractTime(message),
        priority: msg.includes('urgent') || msg.includes('important') ? 'High' : msg.includes('low') ? 'Low' : 'Medium',
        confirmation_message: `✅ I've set your reminder: "${extractReminderTitle(message)}"`,
        suggested_followup: [
          'Show all my reminders',
          'Set another reminder',
          'Change this reminder priority',
        ],
      },
      schedule: {
        event_title: extractMeetingTitle(message),
        date: getSmartDate(message),
        time: extractMeetingTime(message),
        duration_minutes: 45,
        attendees: extractAttendees(message),
        location: msg.includes('zoom') ? 'Zoom Meeting' : msg.includes('office') ? 'Office Conference Room' : 'Virtual',
        agenda: 'Discuss project updates and next steps',
        google_calendar_link: '#',
        conflicts_check: 'No conflicts detected',
        preparation_checklist: [
          'Prepare meeting agenda',
          'Share documents with attendees',
          'Test video/audio setup',
        ],
      },
      task: {
        task_title: extractTaskTitle(message),
        description: message,
        priority: msg.includes('urgent') || msg.includes('high') ? 'High' : msg.includes('low') ? 'Low' : 'Medium',
        estimated_time_minutes: 60,
        category: 'Work',
        subtasks: [
          'Break down into smaller steps',
          'Research requirements',
          'Implement solution',
          'Review and test',
        ],
        deadline: 'Today, 6:00 PM',
        tags: ['productivity', 'hackathon', 'priority'],
        productivity_tip: '🎯 Try the Pomodoro technique — 25 min focused work, 5 min break.',
      },
      summary: {
        date: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
        day_theme: '🚀 Focus & Deliver',
        morning_routine: ['Review priorities', 'Quick team check-in', 'Deep work block'],
        top_3_priorities: [
          'Complete hackathon project submission',
          'Review team feedback',
          'Prepare demo presentation',
        ],
        scheduled_blocks: [
          { time: '9:00 AM', label: 'Deep Work — Project Development' },
          { time: '11:30 AM', label: 'Team Standup' },
          { time: '1:00 PM', label: 'Lunch Break' },
          { time: '2:00 PM', label: 'Feature Integration' },
          { time: '4:30 PM', label: 'Testing & QA' },
        ],
        focus_time_slots: ['9:00–11:30 AM', '2:00–4:30 PM'],
        evening_review_prompt: 'What went well today? What can be improved tomorrow?',
        motivational_message: 'Every line of code brings you closer to your goal. Keep building! 💪',
        productivity_score_yesterday: 82,
        improvement_suggestions: [
          'Try batching similar tasks together',
          'Take regular breaks every 90 minutes',
          'Review your task list before starting work',
        ],
      },
      motivation: {
        quote: 'The only way to do great work is to love what you do.',
        author: 'Steve Jobs',
        reflection: 'Think about what drives your passion. When you connect your daily tasks with your deeper purpose, even the hardest challenges become meaningful.',
        daily_challenge: 'Complete one task you\'ve been procrastinating on before lunch today.',
        affirmation: 'I am capable, creative, and committed to delivering excellence.',
        action_step: 'Write down 3 things you\'re grateful for right now, then tackle your biggest priority.',
      },
      general: {
        response: getGeneralResponse(message),
        intent_detected: 'general',
        next_actions: [
          'Set a reminder for important deadlines',
          'Plan your day with a daily summary',
          'Track your tasks for better productivity',
        ],
        quick_tips: [
          '💡 Try saying "Schedule a meeting" to use the calendar feature',
          '💡 Ask for motivation when you need a boost',
          '💡 Request a daily summary to plan your day',
        ],
        follow_up_questions: [
          'Would you like a daily plan?',
          'Need help prioritizing your tasks?',
          'Want to set a reminder?',
        ],
      },
    };

    return {
      success: true,
      assistant_name: 'ARIA - AI Personal Assistant',
      version: '2.0',
      session_id: `session_${CONFIG.userId}_${Date.now()}`,
      user_id: CONFIG.userId,
      timestamp: new Date().toISOString(),
      greeting: greeting,
      intent: intent,
      original_message: message,
      ai_response: responses[intent],
      user_insights: {
        usage_streak: Math.floor(Math.random() * 30) + 1,
        most_used_feature: intent,
        productivity_index: (Math.random() * 40 + 60).toFixed(1),
        total_tasks_this_week: Math.floor(Math.random() * 20) + 5,
        upcoming_reminders: Math.floor(Math.random() * 5),
      },
      smart_suggestions: [
        'Try asking ARIA to summarize your day every evening',
        'Set recurring reminders for better productivity',
        'Ask ARIA to prioritize your task list',
      ],
      metadata: {
        processing_time_ms: Math.floor(Math.random() * 500) + 200,
        model_used: 'gpt-4o-mini',
        workflow: 'Track 2 - Personal Assistant',
        team: 'Team Ben10',
      },
    };
  }

  // Helper extraction functions
  function extractReminderTitle(msg) {
    const patterns = [
      /remind\s+me\s+to\s+(.+?)(?:\s+by\s|\s+at\s|\s+before\s|\s+tomorrow|\s+today|,)/i,
      /reminder\s*:?\s*(.+?)(?:\s+by\s|\s+at\s|\s+before\s|$)/i,
      /remind\s+me\s+to\s+(.+)/i,
    ];
    for (const p of patterns) {
      const m = msg.match(p);
      if (m) return m[1].trim().replace(/[,.!]+$/, '');
    }
    return msg.substring(0, 60);
  }

  function extractTime(msg) {
    const timeMatch = msg.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i);
    if (timeMatch) {
      const today = msg.toLowerCase().includes('today') ? 'Today' : msg.toLowerCase().includes('tomorrow') ? 'Tomorrow' : 'Today';
      return `${today}, ${timeMatch[1].toUpperCase()}`;
    }
    if (msg.toLowerCase().includes('tonight')) return 'Today, 9:00 PM';
    if (msg.toLowerCase().includes('tomorrow')) return 'Tomorrow, 9:00 AM';
    return 'Today, 6:00 PM';
  }

  function extractMeetingTitle(msg) {
    const m = msg.match(/schedule\s+(?:a\s+)?(.+?)(?:\s+(?:at|on|for|tomorrow|today))/i);
    return m ? m[1].trim() : 'Team Meeting';
  }

  function extractMeetingTime(msg) {
    const m = msg.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/i);
    return m ? m[1] : '3:00 PM';
  }

  function getSmartDate(msg) {
    const today = new Date();
    if (msg.toLowerCase().includes('tomorrow')) {
      today.setDate(today.getDate() + 1);
    }
    return today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function extractAttendees(msg) {
    const m = msg.match(/with\s+(.+?)(?:\s+(?:at|on|for)|$)/i);
    if (m) return m[1].split(/,\s*|and\s+/).map((a) => a.trim());
    return ['Team Members'];
  }

  function extractTaskTitle(msg) {
    const m = msg.match(/(?:add\s+(?:a\s+)?task|todo|to-do)\s*:?\s*(.+?)(?:,|\.|$)/i);
    return m ? m[1].trim() : msg.substring(0, 60);
  }

  function getGeneralResponse(msg) {
    const lower = msg.toLowerCase();
    if (lower.includes('what can you') || lower.includes('help') || lower.includes('what do you')) {
      return `I'm ARIA, your AI Personal Assistant! Here's what I can do:\n\n🔔 **Reminders** — Set and manage reminders with priorities\n📅 **Scheduling** — Schedule meetings and events\n✅ **Tasks** — Create and organize tasks with subtasks\n📊 **Daily Summary** — Get a comprehensive daily plan\n🔥 **Motivation** — Get inspiring quotes and daily challenges\n\nJust type naturally and I'll understand your intent!`;
    }
    if (lower.includes('hello') || lower.includes('hi ') || lower.includes('hey')) {
      return `Hello! 👋 I'm ARIA, ready to help you stay productive and organized. What would you like to do?`;
    }
    return `I understand your request. Let me help you with that! Based on your message, here are some options I can assist with. Try being more specific — for example, say "Remind me to..." or "Schedule a meeting..." and I'll take care of the rest.`;
  }

  // ==========================================
  // UI Rendering
  // ==========================================
  function addMessage(role, text) {
    const msg = { role, text, timestamp: new Date() };
    state.messages.push(msg);

    const el = document.createElement('div');
    el.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : 'A';

    const content = document.createElement('div');
    content.className = 'message-content';

    if (role === 'user') {
      content.textContent = text;
    }

    el.appendChild(avatar);
    el.appendChild(content);
    DOM.messagesContainer.appendChild(el);
    scrollToBottom();
    return el;
  }

  function addTypingIndicator() {
    const el = document.createElement('div');
    el.className = 'message assistant';
    el.innerHTML = `
      <div class="message-avatar">A</div>
      <div class="message-content">
        <div class="typing-indicator">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </div>
      </div>
    `;
    DOM.messagesContainer.appendChild(el);
    scrollToBottom();
    return el;
  }

  function renderAssistantResponse(data) {
    const el = document.createElement('div');
    el.className = 'message assistant';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = 'A';

    const content = document.createElement('div');
    content.className = 'message-content';

    const intent = data.intent || 'general';
    const aiResp = data.ai_response || {};

    // Intent badge
    const badgeIcons = {
      reminder: '🔔', schedule: '📅', task: '✅',
      summary: '📊', motivation: '🔥', general: '💬'
    };
    const badge = document.createElement('div');
    badge.className = `intent-badge ${intent}`;
    badge.textContent = `${badgeIcons[intent] || '💬'} ${intent}`;
    content.appendChild(badge);

    // Render based on intent
    switch (intent) {
      case 'reminder':
        content.appendChild(renderReminder(aiResp));
        break;
      case 'schedule':
        content.appendChild(renderSchedule(aiResp));
        break;
      case 'task':
        content.appendChild(renderTask(aiResp));
        break;
      case 'summary':
        content.appendChild(renderSummary(aiResp));
        break;
      case 'motivation':
        content.appendChild(renderMotivation(aiResp));
        break;
      default:
        content.appendChild(renderGeneral(aiResp));
    }

    // Metadata bar
    if (data.metadata) {
      const meta = document.createElement('div');
      meta.className = 'metadata-bar';
      meta.innerHTML = `
        <span class="meta-chip">⚡ ${data.metadata.processing_time_ms}ms</span>
        <span class="meta-chip"><span class="dot"></span></span>
        <span class="meta-chip">🤖 ${data.metadata.model_used}</span>
        <span class="meta-chip"><span class="dot"></span></span>
        <span class="meta-chip">🏷️ ${data.metadata.team}</span>
      `;
      content.appendChild(meta);
    }

    el.appendChild(avatar);
    el.appendChild(content);
    DOM.messagesContainer.appendChild(el);
    scrollToBottom();
  }

  function renderReminder(data) {
    const frag = document.createDocumentFragment();

    // Confirmation
    const confirm = document.createElement('p');
    confirm.innerHTML = data.confirmation_message || '✅ Reminder set!';
    confirm.style.marginBottom = '10px';
    frag.appendChild(confirm);

    // Details card
    const card = document.createElement('div');
    card.className = 'response-card';
    card.innerHTML = `
      <div class="response-card-title">Reminder Details</div>
      <div class="response-field">
        <span class="field-label">Title</span>
        <span class="field-value">${data.reminder_title || 'N/A'}</span>
      </div>
      <div class="response-field">
        <span class="field-label">Time</span>
        <span class="field-value">${data.reminder_time || 'N/A'}</span>
      </div>
      <div class="response-field">
        <span class="field-label">Priority</span>
        <span class="field-value priority-${(data.priority || 'medium').toLowerCase()}">${data.priority || 'Medium'}</span>
      </div>
    `;
    frag.appendChild(card);

    // Suggestions
    if (data.suggested_followup?.length) {
      const suggestions = document.createElement('div');
      suggestions.className = 'suggestions';
      data.suggested_followup.forEach((s) => {
        const chip = document.createElement('button');
        chip.className = 'suggestion-chip';
        chip.textContent = s;
        suggestions.appendChild(chip);
      });
      frag.appendChild(suggestions);
    }

    return frag;
  }

  function renderSchedule(data) {
    const frag = document.createDocumentFragment();

    const intro = document.createElement('p');
    intro.innerHTML = `📅 I've prepared your event: <strong>${data.event_title || 'Meeting'}</strong>`;
    intro.style.marginBottom = '10px';
    frag.appendChild(intro);

    const card = document.createElement('div');
    card.className = 'response-card';
    card.innerHTML = `
      <div class="response-card-title">Event Details</div>
      <div class="response-field">
        <span class="field-label">Event</span>
        <span class="field-value">${data.event_title || 'N/A'}</span>
      </div>
      <div class="response-field">
        <span class="field-label">Date</span>
        <span class="field-value">${data.date || 'N/A'}</span>
      </div>
      <div class="response-field">
        <span class="field-label">Time</span>
        <span class="field-value">${data.time || 'N/A'}</span>
      </div>
      <div class="response-field">
        <span class="field-label">Duration</span>
        <span class="field-value">${data.duration_minutes || 0} min</span>
      </div>
      <div class="response-field">
        <span class="field-label">Location</span>
        <span class="field-value">${data.location || 'TBD'}</span>
      </div>
      <div class="response-field">
        <span class="field-label">Attendees</span>
        <span class="field-value">${(data.attendees || []).join(', ')}</span>
      </div>
      <div class="response-field">
        <span class="field-label">Conflicts</span>
        <span class="field-value" style="color: var(--accent-emerald)">${data.conflicts_check || 'None'}</span>
      </div>
    `;
    frag.appendChild(card);

    // Preparation checklist
    if (data.preparation_checklist?.length) {
      const prepCard = document.createElement('div');
      prepCard.className = 'response-card';
      prepCard.innerHTML = `<div class="response-card-title">Preparation Checklist</div>`;
      const list = document.createElement('ul');
      list.className = 'subtask-list';
      data.preparation_checklist.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
      });
      prepCard.appendChild(list);
      frag.appendChild(prepCard);
    }

    return frag;
  }

  function renderTask(data) {
    const frag = document.createDocumentFragment();

    const intro = document.createElement('p');
    intro.innerHTML = `✅ Task created: <strong>${data.task_title || 'New Task'}</strong>`;
    intro.style.marginBottom = '10px';
    frag.appendChild(intro);

    const card = document.createElement('div');
    card.className = 'response-card';
    card.innerHTML = `
      <div class="response-card-title">Task Details</div>
      <div class="response-field">
        <span class="field-label">Title</span>
        <span class="field-value">${data.task_title || 'N/A'}</span>
      </div>
      <div class="response-field">
        <span class="field-label">Priority</span>
        <span class="field-value priority-${(data.priority || 'medium').toLowerCase()}">${data.priority || 'Medium'}</span>
      </div>
      <div class="response-field">
        <span class="field-label">Est. Time</span>
        <span class="field-value">${data.estimated_time_minutes || 0} min</span>
      </div>
      <div class="response-field">
        <span class="field-label">Category</span>
        <span class="field-value">${data.category || 'General'}</span>
      </div>
      <div class="response-field">
        <span class="field-label">Deadline</span>
        <span class="field-value">${data.deadline || 'No deadline'}</span>
      </div>
    `;
    frag.appendChild(card);

    // Subtasks
    if (data.subtasks?.length) {
      const subCard = document.createElement('div');
      subCard.className = 'response-card';
      subCard.innerHTML = `<div class="response-card-title">Subtasks</div>`;
      const list = document.createElement('ul');
      list.className = 'subtask-list';
      data.subtasks.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
      });
      subCard.appendChild(list);
      frag.appendChild(subCard);
    }

    // Tags
    if (data.tags?.length) {
      const tagList = document.createElement('div');
      tagList.className = 'tag-list';
      data.tags.forEach((t) => {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = `#${t}`;
        tagList.appendChild(tag);
      });
      frag.appendChild(tagList);
    }

    // Tip
    if (data.productivity_tip) {
      const tip = document.createElement('div');
      tip.className = 'affirmation-card';
      tip.innerHTML = `<div class="label">Productivity Tip</div><p>${data.productivity_tip}</p>`;
      frag.appendChild(tip);
    }

    return frag;
  }

  function renderSummary(data) {
    const frag = document.createDocumentFragment();

    const intro = document.createElement('p');
    intro.innerHTML = `📊 Here's your daily plan for <strong>${data.date || 'today'}</strong>`;
    intro.style.marginBottom = '6px';
    frag.appendChild(intro);

    if (data.day_theme) {
      const theme = document.createElement('p');
      theme.innerHTML = `Theme: <strong>${data.day_theme}</strong>`;
      theme.style.marginBottom = '10px';
      theme.style.color = 'var(--accent-purple)';
      frag.appendChild(theme);
    }

    // Priorities
    if (data.top_3_priorities?.length) {
      const priCard = document.createElement('div');
      priCard.className = 'response-card';
      priCard.innerHTML = `<div class="response-card-title">🎯 Top Priorities</div>`;
      const list = document.createElement('ul');
      list.className = 'subtask-list';
      data.top_3_priorities.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
      });
      priCard.appendChild(list);
      frag.appendChild(priCard);
    }

    // Schedule blocks
    if (data.scheduled_blocks?.length) {
      const schedCard = document.createElement('div');
      schedCard.className = 'response-card';
      schedCard.innerHTML = `<div class="response-card-title">📅 Schedule</div>`;
      data.scheduled_blocks.forEach((block) => {
        const div = document.createElement('div');
        div.className = 'schedule-block';
        div.innerHTML = `
          <span class="block-time">${block.time}</span>
          <span class="block-label">${block.label}</span>
        `;
        schedCard.appendChild(div);
      });
      frag.appendChild(schedCard);
    }

    // Productivity score
    if (data.productivity_score_yesterday) {
      const scoreCard = document.createElement('div');
      scoreCard.className = 'response-card';
      scoreCard.innerHTML = `
        <div class="response-card-title">Yesterday's Performance</div>
        <div class="response-field">
          <span class="field-label">Productivity Score</span>
          <span class="field-value" style="color: var(--accent-emerald)">${data.productivity_score_yesterday}/100</span>
        </div>
      `;
      frag.appendChild(scoreCard);
    }

    // Motivational message
    if (data.motivational_message) {
      const motiv = document.createElement('div');
      motiv.className = 'affirmation-card';
      motiv.innerHTML = `<div class="label">Daily Motivation</div><p>${data.motivational_message}</p>`;
      frag.appendChild(motiv);
    }

    // Suggestions
    if (data.improvement_suggestions?.length) {
      const suggestions = document.createElement('div');
      suggestions.className = 'suggestions';
      data.improvement_suggestions.forEach((s) => {
        const chip = document.createElement('button');
        chip.className = 'suggestion-chip';
        chip.textContent = s;
        suggestions.appendChild(chip);
      });
      frag.appendChild(suggestions);
    }

    return frag;
  }

  function renderMotivation(data) {
    const frag = document.createDocumentFragment();

    // Quote card
    if (data.quote) {
      const quote = document.createElement('div');
      quote.className = 'quote-card';
      quote.innerHTML = `
        <p class="quote-text">"${data.quote}"</p>
        <p class="quote-author">— ${data.author || 'Unknown'}</p>
      `;
      frag.appendChild(quote);
    }

    // Reflection
    if (data.reflection) {
      const ref = document.createElement('div');
      ref.className = 'affirmation-card';
      ref.style.marginTop = '12px';
      ref.innerHTML = `<div class="label">Reflection</div><p>${data.reflection}</p>`;
      frag.appendChild(ref);
    }

    // Daily Challenge
    if (data.daily_challenge) {
      const card = document.createElement('div');
      card.className = 'response-card';
      card.innerHTML = `
        <div class="response-card-title">🏆 Daily Challenge</div>
        <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5">${data.daily_challenge}</p>
      `;
      frag.appendChild(card);
    }

    // Affirmation
    if (data.affirmation) {
      const aff = document.createElement('div');
      aff.className = 'affirmation-card';
      aff.innerHTML = `<div class="label">Today's Affirmation</div><p>${data.affirmation}</p>`;
      frag.appendChild(aff);
    }

    // Action step
    if (data.action_step) {
      const action = document.createElement('div');
      action.className = 'response-card';
      action.innerHTML = `
        <div class="response-card-title">🚀 Action Step</div>
        <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5">${data.action_step}</p>
      `;
      frag.appendChild(action);
    }

    return frag;
  }

  function renderGeneral(data) {
    const frag = document.createDocumentFragment();

    // Main response
    const responseText = data.response || JSON.stringify(data, null, 2);
    const resp = document.createElement('div');
    resp.style.lineHeight = '1.7';
    resp.innerHTML = formatMarkdown(responseText);
    frag.appendChild(resp);

    // Next actions
    if (data.next_actions?.length) {
      const card = document.createElement('div');
      card.className = 'response-card';
      card.innerHTML = `<div class="response-card-title">Suggested Next Actions</div>`;
      const list = document.createElement('ul');
      list.className = 'subtask-list';
      data.next_actions.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
      });
      card.appendChild(list);
      frag.appendChild(card);
    }

    // Quick tips
    if (data.quick_tips?.length) {
      const tips = document.createElement('div');
      tips.className = 'affirmation-card';
      tips.innerHTML = `<div class="label">Quick Tips</div>`;
      data.quick_tips.forEach((t) => {
        const p = document.createElement('p');
        p.textContent = t;
        p.style.marginBottom = '4px';
        tips.appendChild(p);
      });
      frag.appendChild(tips);
    }

    // Follow-up questions as chips
    if (data.follow_up_questions?.length) {
      const suggestions = document.createElement('div');
      suggestions.className = 'suggestions';
      data.follow_up_questions.forEach((q) => {
        const chip = document.createElement('button');
        chip.className = 'suggestion-chip';
        chip.textContent = q;
        suggestions.appendChild(chip);
      });
      frag.appendChild(suggestions);
    }

    return frag;
  }

  function formatMarkdown(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  // ==========================================
  // Loading & Status
  // ==========================================
  function setLoading(loading) {
    state.isLoading = loading;
    const dot = DOM.statusIndicator.querySelector('.status-dot');
    const text = DOM.statusIndicator.querySelector('.status-text');

    if (loading) {
      dot.className = 'status-dot loading';
      text.textContent = 'Thinking...';
    } else {
      dot.className = 'status-dot online';
      text.textContent = 'Online';
    }
  }

  // ==========================================
  // Insights
  // ==========================================
  function updateInsights(insights) {
    state.insights = insights;
    DOM.insightStreak.textContent = `${insights.usage_streak} days 🔥`;
    DOM.insightProductivity.textContent = `${insights.productivity_index}%`;
    DOM.insightTasks.textContent = insights.total_tasks_this_week;
  }

  // ==========================================
  // Toasts
  // ==========================================
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ==========================================
  // Scroll
  // ==========================================
  function scrollToBottom() {
    requestAnimationFrame(() => {
      DOM.chatArea.scrollTop = DOM.chatArea.scrollHeight;
    });
  }

  // ==========================================
  // Bootstrap
  // ==========================================
  document.addEventListener('DOMContentLoaded', init);
})();
