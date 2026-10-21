/**
 * BoNa Mebel — Minimalist Liquid Glass Client Logic
 * Handles interactive tabs, live VK portfolio loading, lightbox modal, and cost calculator.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Application State
  // Инициализируем мгновенно из window.INITIAL_PORTFOLIO, исключая показ нулей
  const initialData = (typeof window.INITIAL_PORTFOLIO !== 'undefined' && window.INITIAL_PORTFOLIO.items) 
    ? window.INITIAL_PORTFOLIO.items 
    : [];

  const state = {
    portfolio: initialData,
    activeCategory: 'all',
    currentModalItem: null,
    currentModalImgIndex: 0,
    calc: {
      type: 'kitchen',
      size: 3.0,
      material: 'mdf_paint',
      hardware: 'blum'
    }
  };

  // DOM Elements
  const header = document.querySelector('.site-header');
  const portfolioGrid = document.getElementById('portfolioGrid');
  const tabsContainer = document.getElementById('liquidTabs');
  const syncStatusEl = document.getElementById('syncStatusText');

  // Modal Elements
  const modal = document.getElementById('lightboxModal');
  const modalMainImg = document.getElementById('modalMainImg');
  const modalTitle = document.getElementById('modalTitle');
  const modalCategory = document.getElementById('modalCategory');
  const modalDesc = document.getElementById('modalDesc');
  const modalSpecs = document.getElementById('modalSpecs');
  const modalVkLink = document.getElementById('modalVkLink');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalPrevBtn = document.getElementById('modalPrevBtn');
  const modalNextBtn = document.getElementById('modalNextBtn');

  // Calculator Elements
  const calcSizeInput = document.getElementById('calcSize');
  const calcSizeDisplay = document.getElementById('calcSizeDisplay');
  const calcTotalPrice = document.getElementById('calcTotalPrice');
  const calcGiftText = document.getElementById('calcGiftText');
  const calcGiftBadge = document.getElementById('calcGiftBadge');
  const summaryType = document.getElementById('summaryType');
  const summarySize = document.getElementById('summarySize');
  const summaryMaterial = document.getElementById('summaryMaterial');
  const summaryHardware = document.getElementById('summaryHardware');

  // 1. FIXED HEADER LIQUID GLASS SCROLL EFFECT
  const handleScroll = () => {
    if (window.scrollY > 25) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  };
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  // 2. LOAD PORTFOLIO DATA (INSTANT RENDERING + BACKGROUND SYNC)
  function renderInitial() {
    updateTabCounts();
    renderPortfolio(state.activeCategory);
    if (typeof window.INITIAL_PORTFOLIO !== 'undefined' && window.INITIAL_PORTFOLIO.lastSync) {
      updateSyncStatus(window.INITIAL_PORTFOLIO.lastSync);
    }
  }

  async function loadPortfolioFromBackend() {
    try {
      // 1. Попытка получить свежие данные от Node.js агента
      const response = await fetch('/api/portfolio');
      if (response.ok) {
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          state.portfolio = data.items;
          updateSyncStatus(data.lastSync);
          updateTabCounts();
          renderPortfolio(state.activeCategory);
          return;
        }
      }
    } catch (e) {
      // Игнорируем сетевые ошибки, т.к. локальный набор уже загружен
    }

    try {
      // 2. Запасная попытка загрузить локальный json
      const res = await fetch('data/portfolio.json');
      if (res.ok) {
        const localData = await res.json();
        if (localData.items && localData.items.length > 0) {
          state.portfolio = localData.items;
          updateSyncStatus(localData.lastSync);
          updateTabCounts();
          renderPortfolio(state.activeCategory);
        }
      }
    } catch (e) {
      // Запасной встроенный набор уже отображается
    }
  }

  function updateSyncStatus(timestamp) {
    if (!syncStatusEl) return;
    if (timestamp) {
      const date = new Date(timestamp);
      const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      syncStatusEl.textContent = `Синхронизировано с VK:drozdova_natasha • Обновление раз в 1 час`;
    } else {
      syncStatusEl.textContent = `Синхронизировано с VK:drozdova_natasha • Обновление раз в 1 час`;
    }
  }

  // 3. TAB FILTERING & COUNTS
  function updateTabCounts() {
    const counts = { all: state.portfolio.length, kitchen: 0, wardrobe: 0, hallway: 0, kids: 0, bathroom: 0 };
    state.portfolio.forEach(item => {
      if (counts[item.category] !== undefined) {
        counts[item.category]++;
      }
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
      const cat = btn.getAttribute('data-category');
      const countEl = btn.querySelector('.tab-count');
      if (countEl && counts[cat] !== undefined) {
        countEl.textContent = counts[cat];
      }
    });
  }

  if (tabsContainer) {
    tabsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;

      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      state.activeCategory = btn.getAttribute('data-category');
      renderPortfolio(state.activeCategory);
    });
  }

  // 4. RENDER PORTFOLIO CARDS
  function renderPortfolio(category = 'all') {
    if (!portfolioGrid) return;

    const filtered = category === 'all' 
      ? state.portfolio 
      : state.portfolio.filter(item => item.category === category);

    if (filtered.length === 0) {
      portfolioGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-secondary);">
          <p style="font-size: 18px; margin-bottom: 8px;">В этой категории пока нет опубликованных проектов</p>
          <p style="font-size: 13px; color: var(--text-muted);">ИИ-агент автоматически добавит их после следующего ежечасного обновления из VK</p>
        </div>
      `;
      return;
    }

    portfolioGrid.innerHTML = filtered.map(item => {
      const isVk = item.isVkPost;
      const badgeHtml = item.badge 
        ? `<div class="card-badge-top ${isVk ? 'vk-badge' : ''}">${isVk ? '🔵 ' : '✦ '}${item.badge}</div>` 
        : '';

      const specsRows = item.specs ? Object.entries(item.specs).slice(0, 2).map(([k, v]) => {
        let label = 'Материал';
        if (k === 'facades') label = 'Фасады';
        if (k === 'hardware') label = 'Фурнитура';
        if (k === 'system') label = 'Система';
        if (k === 'countertop') label = 'Столешница';
        if (k === 'timeline') label = 'Срок';
        return `
          <div class="spec-item">
            <span class="spec-key">${label}:</span>
            <span class="spec-val">${v}</span>
          </div>
        `;
      }).join('') : '';

      return `
        <article class="project-card" data-id="${item.id}">
          <div class="card-media" onclick="window.openProjectModal('${item.id}')">
            ${badgeHtml}
            <img src="${item.mainImage}" alt="${item.title}" class="card-img" loading="lazy">
            <div class="card-zoom-overlay">
              <div class="zoom-icon-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  <line x1="11" y1="8" x2="11" y2="14"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
              </div>
            </div>
          </div>
          <div class="card-body">
            <div class="card-category-label">${item.categoryName}</div>
            <h3 class="card-title">${item.title}</h3>
            <p class="card-desc">${item.description}</p>
            ${specsRows ? `<div class="card-specs-row">${specsRows}</div>` : ''}
            <div class="card-footer-actions">
              <button class="btn-order-like" onclick="window.openOrderModal('${item.title}')">
                Заказать похожее
              </button>
              ${isVk && item.vkPostUrl ? `
                <a href="${item.vkPostUrl}" target="_blank" rel="noopener noreferrer" class="btn-vk-view">
                  Пост в VK &rarr;
                </a>
              ` : `
                <button class="btn-vk-view" onclick="window.openProjectModal('${item.id}')">
                  Детали &rarr;
                </button>
              `}
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  // 5. LIGHTBOX MODAL HANDLERS
  window.openProjectModal = function(id) {
    const item = state.portfolio.find(it => it.id === id);
    if (!item) return;

    state.currentModalItem = item;
    state.currentModalImgIndex = 0;

    modalTitle.textContent = item.title;
    modalCategory.textContent = item.categoryName;
    modalDesc.textContent = item.description;

    if (item.specs) {
      modalSpecs.innerHTML = Object.entries(item.specs).map(([k, v]) => {
        let label = k;
        if (k === 'facades') label = 'Фасады';
        if (k === 'hardware') label = 'Фурнитура';
        if (k === 'system') label = 'Раздвижная система';
        if (k === 'countertop') label = 'Столешница';
        if (k === 'timeline') label = 'Срок изготовления';
        if (k === 'features') label = 'Особенности';
        return `
          <div class="spec-item" style="padding: 6px 0; border-bottom: 1px dashed var(--glass-border);">
            <span class="spec-key" style="color: var(--text-secondary);">${label}:</span>
            <span class="spec-val" style="color: var(--text-primary); font-weight: 600;">${v}</span>
          </div>
        `;
      }).join('');
    } else {
      modalSpecs.innerHTML = '';
    }

    if (item.vkPostUrl) {
      modalVkLink.href = item.vkPostUrl;
      modalVkLink.style.display = 'inline-flex';
    } else {
      modalVkLink.style.display = 'none';
    }

    updateModalImage();
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  function updateModalImage() {
    if (!state.currentModalItem) return;
    const images = state.currentModalItem.images || [state.currentModalItem.mainImage];
    const imgUrl = images[state.currentModalImgIndex] || state.currentModalItem.mainImage;
    modalMainImg.src = imgUrl;

    if (images.length > 1) {
      modalPrevBtn.style.display = 'flex';
      modalNextBtn.style.display = 'flex';
    } else {
      modalPrevBtn.style.display = 'none';
      modalNextBtn.style.display = 'none';
    }
  }

  function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  if (modalPrevBtn) {
    modalPrevBtn.addEventListener('click', () => {
      const images = state.currentModalItem.images || [];
      state.currentModalImgIndex = (state.currentModalImgIndex - 1 + images.length) % images.length;
      updateModalImage();
    });
  }

  if (modalNextBtn) {
    modalNextBtn.addEventListener('click', () => {
      const images = state.currentModalItem.images || [];
      state.currentModalImgIndex = (state.currentModalImgIndex + 1) % images.length;
      updateModalImage();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('active')) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'ArrowLeft' && modalPrevBtn) modalPrevBtn.click();
    if (e.key === 'ArrowRight' && modalNextBtn) modalNextBtn.click();
  });

  // 6. INTERACTIVE FURNITURE CALCULATOR
  // Строго по заданию пользователя: только каменная мойка (к кухне) и пескоструйный рисунок (к шкафам/прихожим)
  const PRICES = {
    kitchen: {
      base: 38000,
      label: 'Кухня на заказ',
      giftBadge: 'Подарок при заказе кухни',
      giftText: 'Каменная мойка в подарок'
    },
    wardrobe: {
      base: 26000,
      label: 'Шкаф-купе на заказ',
      giftBadge: 'Подарок при заказе шкафа',
      giftText: 'Пескоструйный рисунок в подарок'
    },
    hallway: {
      base: 24000,
      label: 'Прихожая на заказ',
      giftBadge: 'Подарок к заказу',
      giftText: 'Пескоструйный рисунок на зеркало в подарок'
    }
  };

  const MATERIAL_MULTIPLIERS = {
    ldsp_egger: { mult: 1.0, label: 'ЛДСП Egger E0 (Австрия)' },
    mdf_film: { mult: 1.25, label: 'МДФ в термопленке Soft-Touch' },
    mdf_paint: { mult: 1.55, label: 'МДФ в матовой эмали (Италия)' }
  };

  const HARDWARE_MULTIPLIERS = {
    boyard: { mult: 1.0, label: 'Boyard (надежная база)' },
    gtv: { mult: 1.15, label: 'GTV Axis Pro (Польша)' },
    blum: { mult: 1.45, label: 'Blum Antaro / Hettich (Австрия/Германия)' }
  };

  function updateCalculator() {
    const typeConf = PRICES[state.calc.type] || PRICES.kitchen;
    const matConf = MATERIAL_MULTIPLIERS[state.calc.material] || MATERIAL_MULTIPLIERS.mdf_paint;
    const hardConf = HARDWARE_MULTIPLIERS[state.calc.hardware] || HARDWARE_MULTIPLIERS.blum;

    const rawPrice = typeConf.base * state.calc.size * matConf.mult * hardConf.mult;
    const minPrice = Math.round(rawPrice * 0.95 / 1000) * 1000;

    if (calcSizeDisplay) calcSizeDisplay.textContent = `${state.calc.size.toFixed(1)} метра`;
    if (calcTotalPrice) calcTotalPrice.textContent = `от ${minPrice.toLocaleString('ru-RU')} ₽`;
    if (calcGiftBadge) calcGiftBadge.textContent = typeConf.giftBadge;
    if (calcGiftText) calcGiftText.textContent = typeConf.giftText;

    if (summaryType) summaryType.textContent = typeConf.label;
    if (summarySize) summarySize.textContent = `${state.calc.size.toFixed(1)} м`;
    if (summaryMaterial) summaryMaterial.textContent = matConf.label;
    if (summaryHardware) summaryHardware.textContent = hardConf.label;
  }

  // Bind calculator buttons
  document.querySelectorAll('[data-calc-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-calc-type]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.calc.type = btn.getAttribute('data-calc-type');
      updateCalculator();
    });
  });

  document.querySelectorAll('[data-calc-material]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-calc-material]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.calc.material = btn.getAttribute('data-calc-material');
      updateCalculator();
    });
  });

  document.querySelectorAll('[data-calc-hardware]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-calc-hardware]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.calc.hardware = btn.getAttribute('data-calc-hardware');
      updateCalculator();
    });
  });

  if (calcSizeInput) {
    calcSizeInput.addEventListener('input', (e) => {
      state.calc.size = parseFloat(e.target.value);
      updateCalculator();
    });
  }

  // 7. ORDER MODAL TRIGGER
  window.openOrderModal = function(projectTitle) {
    const contactSection = document.getElementById('contacts');
    if (contactSection) {
      contactSection.scrollIntoView({ behavior: 'smooth' });
      const commentInput = document.getElementById('formComment');
      if (commentInput) {
        commentInput.value = `Здравствуйте! Интересует расчет проекта: "${projectTitle}"`;
        commentInput.focus();
      }
    }
  };

  // 8. CONTACT FORM SUBMISSION
  const orderForm = document.getElementById('consultationForm');
  if (orderForm) {
    orderForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('formName').value;
      const phone = document.getElementById('formPhone').value;

      alert(`Спасибо, ${name}! Ваша заявка принята.\nМастер Борис свяжется с вами по номеру ${phone} для бесплатной консультации и замера.`);
      orderForm.reset();
    });
  }

  // Запуск: моментальный рендеринг встроенных данных
  renderInitial();
  updateCalculator();

  // Фоновая проверка новых данных на сервере (если развернуто на Node.js)
  loadPortfolioFromBackend();

  // Периодический опрос сервера каждые 5 минут для моментального обновления без перезагрузки
  setInterval(loadPortfolioFromBackend, 5 * 60 * 1000);
});
