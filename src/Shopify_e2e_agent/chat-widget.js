/**
 * Selvia Agent - AI Shopping Assistant
 * Powered by Selvia Engine for customer support
 * A self-contained chat widget for Shopify storefronts
 */
(function() {
  'use strict';

  // Configuration
  const getWebhookUrl = () => {
    if (window.CHATBOT_CONFIG && window.CHATBOT_CONFIG.webhookUrl) {
      return window.CHATBOT_CONFIG.webhookUrl;
    }
    const script = document.currentScript || document.querySelector('script[data-webhook-url]');
    if (script && script.dataset.webhookUrl) {
      return script.dataset.webhookUrl;
    }
    const root = document.getElementById('ai-chatbot-root');
    if (root && root.dataset.webhookUrl) {
      return root.dataset.webhookUrl;
    }
    return 'http://localhost:5678/webhook/shopify-chat';
  };

  // Inject styles
  const styles = `
    .ai-chatbot-bubble {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: #5C6AC4;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(92, 106, 196, 0.4);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .ai-chatbot-bubble:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 16px rgba(92, 106, 196, 0.5);
    }
    .ai-chatbot-bubble:focus {
      outline: 3px solid #5C6AC4;
      outline-offset: 2px;
    }
    .ai-chatbot-bubble svg {
      width: 28px;
      height: 28px;
      fill: white;
    }

    .ai-chatbot-bubble-label {
      position: fixed;
      bottom: 90px;
      right: 24px;
      background: white;
      color: #5C6AC4;
      padding: 8px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .ai-chatbot-panel {
      position: fixed;
      bottom: 100px;
      right: 24px;
      width: 380px;
      height: 500px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
      z-index: 999999;
      display: none;
      flex-direction: column;
      overflow: hidden;
      animation: ai-chatbot-slide-up 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .ai-chatbot-panel.open {
      display: flex;
    }
    @keyframes ai-chatbot-slide-up {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .ai-chatbot-header {
      background: #5C6AC4;
      color: white;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .ai-chatbot-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    .ai-chatbot-close {
      background: transparent;
      border: none;
      color: white;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
    }
    .ai-chatbot-close:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .ai-chatbot-close:focus {
      outline: 2px solid white;
      outline-offset: 2px;
    }
    .ai-chatbot-close svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }

    .ai-chatbot-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .ai-chatbot-message {
      max-width: 85%;
      padding: 12px 16px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
    }
    .ai-chatbot-message.user {
      align-self: flex-end;
      background: #5C6AC4;
      color: white;
      border-bottom-right-radius: 4px;
    }
    .ai-chatbot-message.assistant {
      align-self: flex-start;
      background: #f1f1f1;
      color: #333;
      border-bottom-left-radius: 4px;
    }

    .ai-chatbot-typing {
      align-self: flex-start;
      background: #f1f1f1;
      padding: 12px 16px;
      border-radius: 16px;
      border-bottom-left-radius: 4px;
      display: flex;
      gap: 4px;
    }
    .ai-chatbot-typing span {
      width: 8px;
      height: 8px;
      background: #999;
      border-radius: 50%;
      animation: ai-chatbot-bounce 1.4s infinite ease-in-out both;
    }
    .ai-chatbot-typing span:nth-child(1) { animation-delay: -0.32s; }
    .ai-chatbot-typing span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes ai-chatbot-bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }

    .ai-chatbot-product {
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 12px;
      margin-top: 8px;
    }
    .ai-chatbot-product-title {
      font-weight: 600;
      color: #333;
      margin-bottom: 4px;
    }
    .ai-chatbot-product-price {
      color: #5C6AC4;
      font-weight: 500;
    }
    .ai-chatbot-product-image {
      width: 100%;
      height: 120px;
      object-fit: cover;
      border-radius: 4px;
      margin-bottom: 8px;
    }

    .ai-chatbot-btn {
      display: inline-block;
      background: #5C6AC4;
      color: white;
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      margin-top: 8px;
      transition: background 0.2s ease;
    }
    .ai-chatbot-btn:hover {
      background: #4a5ab8;
    }

    .ai-chatbot-input-area {
      padding: 16px;
      border-top: 1px solid #e0e0e0;
      display: flex;
      gap: 8px;
    }
    .ai-chatbot-input {
      flex: 1;
      padding: 12px 16px;
      border: 1px solid #e0e0e0;
      border-radius: 24px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s ease;
    }
    .ai-chatbot-input:focus {
      border-color: #5C6AC4;
    }
    .ai-chatbot-send {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #5C6AC4;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s ease;
    }
    .ai-chatbot-send:hover {
      background: #4a5ab8;
    }
    .ai-chatbot-send:focus {
      outline: 3px solid #5C6AC4;
      outline-offset: 2px;
    }
    .ai-chatbot-send:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    .ai-chatbot-send svg {
      width: 20px;
      height: 20px;
      fill: white;
    }

    .ai-chatbot-footer {
      padding: 8px 16px;
      text-align: center;
      font-size: 11px;
      color: #888;
      border-top: 1px solid #f0f0f0;
      background: #fafafa;
    }

    @media (max-width: 767px) {
      .ai-chatbot-panel {
        width: calc(100% - 32px);
        height: calc(100% - 140px);
        right: 16px;
        bottom: 90px;
        border-radius: 12px;
      }
      .ai-chatbot-bubble {
        bottom: 16px;
        right: 16px;
      }
      .ai-chatbot-bubble-label {
        display: none;
      }
    }
  `;

  // Inject style tag
  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  // Create DOM elements
  const createWidget = () => {
    // Label above bubble
    const bubbleLabel = document.createElement('div');
    bubbleLabel.className = 'ai-chatbot-bubble-label';
    bubbleLabel.textContent = 'Selvia Agent';

    // Chat bubble
    const bubble = document.createElement('button');
    bubble.className = 'ai-chatbot-bubble';
    bubble.setAttribute('aria-label', 'Chat with Selvia Agent');
    bubble.setAttribute('title', 'Selvia Agent');
    bubble.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
        <path d="M7 9h10v2H7zm0-3h10v2H7z"/>
      </svg>
    `;

    // Chat panel
    const panel = document.createElement('div');
    panel.className = 'ai-chatbot-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Selvia Agent chat');
    panel.innerHTML = `
      <div class="ai-chatbot-header">
        <h3>Selvia Agent</h3>
        <button class="ai-chatbot-close" aria-label="Close chat">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
      <div class="ai-chatbot-messages" role="log" aria-live="polite"></div>
      <div class="ai-chatbot-input-area">
        <input type="text" class="ai-chatbot-input" placeholder="Ask about products..." aria-label="Type your message">
        <button class="ai-chatbot-send" aria-label="Send message">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
      <div class="ai-chatbot-footer">Powered by Selvia</div>
    `;

    document.body.appendChild(bubbleLabel);
    document.body.appendChild(bubble);
    document.body.appendChild(panel);

    return { bubble, bubbleLabel, panel };
  };

  // Widget logic
  const initWidget = () => {
    const { bubble, bubbleLabel, panel } = createWidget();
    const messagesContainer = panel.querySelector('.ai-chatbot-messages');
    const input = panel.querySelector('.ai-chatbot-input');
    const sendBtn = panel.querySelector('.ai-chatbot-send');
    const closeBtn = panel.querySelector('.ai-chatbot-close');

    let isOpen = false;
    let isFirstOpen = true;

    const togglePanel = () => {
      isOpen = !isOpen;
      panel.classList.toggle('open', isOpen);
      bubble.setAttribute('aria-expanded', isOpen);

      // Hide label when panel is open
      bubbleLabel.style.display = isOpen ? 'none' : 'block';

      if (isOpen) {
        if (isFirstOpen) {
          addMessage('assistant', "Hi! I'm Selvia, your shopping assistant. I can help you find products, add items to your cart, and checkout. What are you looking for?");
          isFirstOpen = false;
        }
        input.focus();
      }
    };

    const addMessage = (type, content) => {
      const msg = document.createElement('div');
      msg.className = `ai-chatbot-message ${type}`;
      msg.innerHTML = content;
      messagesContainer.appendChild(msg);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    const showTyping = () => {
      const typing = document.createElement('div');
      typing.className = 'ai-chatbot-typing';
      typing.id = 'ai-chatbot-typing';
      typing.innerHTML = '<span></span><span></span><span></span>';
      messagesContainer.appendChild(typing);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    const hideTyping = () => {
      const typing = document.getElementById('ai-chatbot-typing');
      if (typing) typing.remove();
    };

    const formatSearchResults = (data) => {
      const products = data?.data?.products?.edges || [];
      if (products.length === 0) {
        return "I couldn't find any products matching your search. Try searching for: shirts, dresses, shoes, watches, belts, jackets, or pants.";
      }

      let html = `I found ${products.length} product${products.length > 1 ? 's' : ''}:`;
      products.slice(0, 5).forEach(edge => {
        const product = edge.node;
        const variant = product.variants?.edges?.[0]?.node;
        const image = product.images?.edges?.[0]?.node?.url;
        const price = variant?.price;

        html += '<div class="ai-chatbot-product">';
        if (image) {
          html += `<img src="${image}" alt="${product.title}" class="ai-chatbot-product-image">`;
        }
        html += `<div class="ai-chatbot-product-title">${product.title}</div>`;
        if (price) {
          html += `<div class="ai-chatbot-product-price">${price.amount} ${price.currencyCode}</div>`;
        }
        html += '</div>';
      });

      if (products.length > 0) {
        html += '<br>Would you like to add any of these to your cart? Just say "add [product name] to cart".';
      }

      return html;
    };

    const formatCartResponse = (data) => {
      if (data.success === false) {
        return data.message || data.error || "Sorry, I couldn't add that to your cart.";
      }

      if (data.message && data.checkoutUrl) {
        return `${data.message}<br><a href="${data.checkoutUrl}" target="_blank" class="ai-chatbot-btn">Proceed to Checkout</a>`;
      }

      if (data.checkoutUrl) {
        const items = data.items || [];
        const itemText = items.map(i => `${i.title} (${i.quantity}x)`).join(', ');
        return `Added ${itemText} to your cart!<br><a href="${data.checkoutUrl}" target="_blank" class="ai-chatbot-btn">Proceed to Checkout</a>`;
      }

      return "Item added to cart successfully!";
    };

    const formatResponse = (data) => {
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (e) {
          return data;
        }
      }

      if (data.response) {
        try {
          data = JSON.parse(data.response);
        } catch (e) {
          return data.response;
        }
      }

      if (data.cartId || data.checkoutUrl || data.success !== undefined) {
        return formatCartResponse(data);
      }

      if (data.data?.products) {
        return formatSearchResults(data);
      }

      if (data.error) {
        return data.message || "Sorry, something went wrong. Please try again.";
      }

      if (data.message) {
        return data.message;
      }

      return "I received your message. How else can I help you?";
    };

    const sendMessage = async () => {
      const message = input.value.trim();
      if (!message) return;

      addMessage('user', message);
      input.value = '';
      sendBtn.disabled = true;
      showTyping();

      try {
        const webhookUrl = getWebhookUrl();
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ message })
        });

        const data = await response.json();
        hideTyping();
        addMessage('assistant', formatResponse(data));
      } catch (error) {
        hideTyping();
        console.error('Chatbot error:', error);
        addMessage('assistant', "Sorry, I'm having trouble connecting. Please check if the webhook is running and try again.");
      } finally {
        sendBtn.disabled = false;
      }
    };

    // Event listeners
    bubble.addEventListener('click', togglePanel);
    closeBtn.addEventListener('click', togglePanel);
    sendBtn.addEventListener('click', sendMessage);

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        togglePanel();
        bubble.focus();
      }
    });
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
  } else {
    initWidget();
  }

  // Expose config interface
  window.ShopifyChatbot = {
    setWebhookUrl: (url) => {
      window.CHATBOT_CONFIG = window.CHATBOT_CONFIG || {};
      window.CHATBOT_CONFIG.webhookUrl = url;
    }
  };
})();
