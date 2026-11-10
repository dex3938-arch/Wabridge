// WaBridge site — tiny progressive enhancement. The site works fully without JavaScript.
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js');

  // Sticky header shadow
  var header = document.querySelector('.site-header');
  var onScroll = function () {
    if (header) header.classList.toggle('scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Close the mobile menu after choosing a link
  var mobile = document.querySelector('.mobile-nav');
  if (mobile) {
    mobile.addEventListener('click', function (e) {
      if (e.target.closest('a')) mobile.removeAttribute('open');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') mobile.removeAttribute('open');
    });
  }

  // Reveal on scroll
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    items.forEach(function (el) {
      io.observe(el);
    });
  } else {
    items.forEach(function (el) {
      el.classList.add('in');
    });
  }

  // Contact form: validation, spam traps, then send to the configured endpoint
  // (WaBridge /api/public/leads) or fall back to e-mail.
  var form = document.getElementById('contact-form');
  if (!form) return;
  var startedAt = Date.now();
  var status = form.querySelector('.form-status');
  var endpoint = form.getAttribute('data-endpoint') || '';
  var mailto = form.getAttribute('data-mailto') || '';

  var rules = {
    name: function (v) {
      return v.length >= 2 && v.length <= 80;
    },
    email: function (v) {
      return v === '' || /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(v);
    },
    phone: function (v) {
      var d = v.replace(/\D/g, '');
      return d.length >= 10 && d.length <= 15;
    },
    message: function (v) {
      return v.length >= 10 && v.length <= 2000;
    },
  };

  function setStatus(kind, text) {
    status.className = 'form-status ' + kind;
    status.textContent = text;
  }

  function validate() {
    var ok = true;
    Object.keys(rules).forEach(function (name) {
      var input = form.elements[name];
      if (!input) return;
      var good = rules[name](String(input.value || '').trim());
      input.closest('.field').classList.toggle('invalid', !good);
      input.setAttribute('aria-invalid', good ? 'false' : 'true');
      if (!good && ok) {
        input.focus();
        ok = false;
      }
    });
    var consent = form.elements.consent;
    if (consent && !consent.checked) {
      if (ok) consent.focus();
      ok = false;
      setStatus('bad', 'Please tick the consent box so we can reply to you.');
    }
    return ok;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form.elements.website && form.elements.website.value) return; // honeypot filled → bot
    if (Date.now() - startedAt < 3000) {
      setStatus('bad', 'That was quick! Please check your details and press send again.');
      startedAt = 0;
      return;
    }
    if (!validate()) return;

    var data = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      phone: form.elements.phone.value.trim(),
      topic: form.elements.topic ? form.elements.topic.value : '',
      message: form.elements.message.value.trim(),
      consent: true,
      page: location.pathname,
    };
    var button = form.querySelector('button[type="submit"]');

    if (!endpoint) {
      // No backend configured: open the visitor's e-mail app with everything filled in.
      if (!mailto) {
        setStatus('bad', 'The contact form is not connected yet. Please reach us on WhatsApp or e-mail.');
        return;
      }
      var body = 'Name: ' + data.name + '\nPhone: ' + data.phone + '\nEmail: ' + data.email + '\nTopic: ' + data.topic + '\n\n' + data.message;
      location.href = 'mailto:' + mailto + '?subject=' + encodeURIComponent('WaBridge enquiry from ' + data.name) + '&body=' + encodeURIComponent(body);
      setStatus('ok', 'Your e-mail app should open with your message ready to send.');
      return;
    }

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'omit',
      mode: 'cors',
      referrerPolicy: 'strict-origin-when-cross-origin',
    })
      .then(function (res) {
        return res.json().catch(function () {
          return {};
        }).then(function (j) {
          if (!res.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
          form.reset();
          setStatus('ok', 'Thank you! We received your message and will reply on WhatsApp or e-mail soon.');
        });
      })
      .catch(function (err) {
        setStatus('bad', err.message || 'Network error. Please try again.');
      })
      .then(function () {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      });
  });
})();
