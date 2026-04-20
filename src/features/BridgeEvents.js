const EVENT_NAME = 'todo-swipe-card-go';
const INIT_FLAG = '__todoSwipeCardBridgeInitialized';

function normalizeEvent(event) {
  const detail = event?.detail ?? {};

  if (event.type === 'll-custom') {
    if (detail.event !== EVENT_NAME) return null;
    return detail.event_data ?? detail;
  }

  if (event.type === EVENT_NAME) {
    return detail.event_data ?? detail;
  }

  return null;
}

function findAllInRoot(root, selector, out = []) {
  if (!root) return out;

  try {
    if (root.querySelectorAll) {
      out.push(...root.querySelectorAll(selector));
    }
  } catch (_) {
    return out;
  }

  const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
  for (const node of nodes) {
    if (node.shadowRoot) {
      findAllInRoot(node.shadowRoot, selector, out);
    }
  }

  return out;
}

function getOrderedTodoCards() {
  const cards = [...new Set(findAllInRoot(document, 'todo-swipe-card'))];

  return cards
    .filter((card) => card && typeof card.getBoundingClientRect === 'function')
    .sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();

      if (Math.abs(aRect.top - bRect.top) > 10) {
        return aRect.top - bRect.top;
      }

      return aRect.left - bRect.left;
    });
}

function getCardConfig(card) {
  return card?.config ?? card?._config ?? null;
}

function cardContainsEntity(card, entityId) {
  const cardConfig = getCardConfig(card);
  const entities = cardConfig?.entities;

  if (!Array.isArray(entities)) return false;

  return entities.some((item) => {
    if (typeof item === 'string') return item === entityId;
    if (item && typeof item === 'object') return item.entity === entityId;
    return false;
  });
}

function getUniqueTodoCardBelow(node) {
  if (!node || typeof node !== 'object') return null;

  if (node.tagName && node.tagName.toLowerCase() === 'todo-swipe-card') {
    return node;
  }

  const found = [];

  if (node.querySelectorAll) {
    found.push(...node.querySelectorAll('todo-swipe-card'));
  }

  if (node.shadowRoot?.querySelectorAll) {
    found.push(...node.shadowRoot.querySelectorAll('todo-swipe-card'));
  }

  return found.length === 1 ? found[0] : null;
}

function findTodoCard(data, event) {
  const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];

  for (const node of eventPath) {
    const localCard = getUniqueTodoCardBelow(node);
    if (localCard) return localCard;
  }

  const cardIndex = Number(data.card_index);
  if (Number.isInteger(cardIndex) && cardIndex >= 0) {
    const cards = getOrderedTodoCards();
    if (cards[cardIndex]) {
      return cards[cardIndex];
    }
  }

  if (data.scope_entity) {
    const cards = getOrderedTodoCards();
    const scopedCard = cards.find((card) => cardContainsEntity(card, data.scope_entity));
    if (scopedCard) {
      return scopedCard;
    }
  }

  if (data.selector) {
    const cards = findAllInRoot(document, data.selector);
    if (cards.length) {
      return cards[0];
    }
  }

  const cards = getOrderedTodoCards();
  return cards[0] ?? null;
}

function goToIndex(card, index) {
  if (typeof card.goToSlide === 'function') {
    card.goToSlide(index);
    return true;
  }

  if (typeof card.goTo === 'function') {
    card.goTo(index);
    return true;
  }

  if (typeof card.slideTo === 'function') {
    card.slideTo(index);
    return true;
  }

  const swiper =
    card.swiper ??
    card._swiper ??
    card.__swiper ??
    card.renderRoot?.querySelector?.('.swiper')?.swiper ??
    card.shadowRoot?.querySelector?.('.swiper')?.swiper;

  if (swiper && typeof swiper.slideTo === 'function') {
    swiper.slideTo(index);
    return true;
  }

  return false;
}

function handleBridgeEvent(event) {
  try {
    const data = normalizeEvent(event);
    if (!data) return;

    const index = Number(data.index);
    if (!Number.isInteger(index) || index < 0) {
      console.warn('todo-swipe-card bridge: invalid index', data.index);
      return;
    }

    const card = findTodoCard(data, event);
    if (!card) {
      console.warn('todo-swipe-card bridge: target todo-swipe-card not found', data);
      return;
    }

    if (!goToIndex(card, index)) {
      console.warn('todo-swipe-card bridge: no supported navigation API found', card);
    }
  } catch (error) {
    console.error('todo-swipe-card bridge error:', error);
  }
}

function createBridgeApi() {
  return {
    goTo(index, options = {}) {
      document.dispatchEvent(
        new CustomEvent(EVENT_NAME, {
          detail: { index, ...options },
          bubbles: true,
          composed: true
        })
      );
    }
  };
}

export function initTodoSwipeBridge() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window[INIT_FLAG]) return;

  window[INIT_FLAG] = true;

  window.addEventListener('ll-custom', handleBridgeEvent, true);
  document.addEventListener(EVENT_NAME, handleBridgeEvent, true);

  const bridgeApi = window.todoSwipeBridge ?? {};
  if (typeof bridgeApi.goTo !== 'function') {
    Object.assign(bridgeApi, createBridgeApi());
  }
  window.todoSwipeBridge = bridgeApi;
}
