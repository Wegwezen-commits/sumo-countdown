// language.js — loads data/translations.json and swaps text without a reload.
(function (global) {
  "use strict";

  const LOCALE_MAP = { en: "en-US", ja: "ja-JP", nl: "nl-NL" };

  const I18n = {
    dict: {},
    lang: "en",

    async load() {
      this.dict = await SumoUtil.fetchJSON("data/translations.json");
      const saved = SumoUtil.storage.get("lang", null);
      const browser = (navigator.language || "en").slice(0, 2);
      this.lang = saved || (this.dict[browser] ? browser : "en");
      return this.lang;
    },

    set(lang) {
      if (!this.dict[lang]) return;
      this.lang = lang;
      SumoUtil.storage.set("lang", lang);
      document.documentElement.lang = lang;
      this.applyStaticText();
      document.dispatchEvent(new CustomEvent("languagechange"));
    },

    locale() { return LOCALE_MAP[this.lang] || "en-US"; },

    t(key, vars) {
      let str = (this.dict[this.lang] && this.dict[this.lang][key]) || (this.dict.en && this.dict.en[key]) || key;
      if (vars) {
        Object.keys(vars).forEach((k) => { str = str.replace(`{${k}}`, vars[k]); });
      }
      return str;
    },

    applyStaticText() {
      document.querySelectorAll("[data-i18n]").forEach((el) => {
        el.textContent = this.t(el.getAttribute("data-i18n"));
      });
      document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
        el.setAttribute("aria-label", this.t(el.getAttribute("data-i18n-aria")));
      });
      document.title = this.t("title");
      const desc = document.querySelector('meta[name="description"]');
      if (desc) desc.setAttribute("content", this.t("subtitle"));
    }
  };

  global.I18n = I18n;
})(window);
