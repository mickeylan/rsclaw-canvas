<template>
  <div class="shell">
    <main class="shell__content">
      <router-view />
    </main>

    <div class="shell__utility" aria-label="应用设置">
      <button class="utility-button" type="button" @click="settingsOpen = true">
        <SettingOutlined />
        <span>设置</span>
      </button>

      <div class="theme-switch" role="group" aria-label="外观主题">
        <button
          type="button"
          :class="{ 'theme-switch__button--active': appearance.mode === 'dark' }"
          :aria-pressed="appearance.mode === 'dark'"
          @click="appearance.setMode('dark')"
        >
          <StarOutlined />
          <span>深色</span>
        </button>
        <button
          type="button"
          :class="{ 'theme-switch__button--active': appearance.mode === 'light' }"
          :aria-pressed="appearance.mode === 'light'"
          @click="appearance.setMode('light')"
        >
          <BulbOutlined />
          <span>浅色</span>
        </button>
      </div>
    </div>

    <a-modal
      v-model:open="settingsOpen"
      title="设置"
      width="1120px"
      :footer="null"
      :destroy-on-close="false"
      wrap-class-name="settings-shell-modal"
    >
      <SettingsView embedded />
    </a-modal>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { BulbOutlined, SettingOutlined, StarOutlined } from '@ant-design/icons-vue'
import SettingsView from '../views/SettingsView.vue'
import { useAppearanceStore } from '../stores/appearance'

const appearance = useAppearanceStore()
const settingsOpen = ref(false)
</script>

<style scoped>
.shell {
  position: relative;
  width: 100%;
  height: 100%;
}

.shell__content {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.shell__utility {
  position: fixed;
  bottom: 20px;
  left: 24px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  background: var(--surface-translucent);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}

.utility-button,
.theme-switch button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 11px;
  border: 0;
  border-radius: 9px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  transition:
    color 150ms ease,
    background 150ms ease;
}

.utility-button:hover,
.theme-switch button:hover {
  color: var(--text);
  background: var(--surface-soft);
}

.utility-button:focus-visible,
.theme-switch button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.utility-button {
  color: var(--text);
}

.theme-switch {
  display: flex;
  gap: 2px;
  padding-left: 7px;
  border-left: 1px solid var(--border-soft);
}

.theme-switch .theme-switch__button--active {
  color: var(--primary);
  background: var(--primary-soft);
}

:global(.settings-shell-modal .ant-modal) {
  max-width: calc(100vw - 48px);
  padding-bottom: 0;
}

:global(.settings-shell-modal .ant-modal-body) {
  max-height: calc(100vh - 150px);
  overflow: auto;
}

@media (max-width: 760px) {
  .shell__utility {
    bottom: 14px;
    left: 14px;
  }

  .utility-button span,
  .theme-switch span {
    display: none;
  }

  .utility-button,
  .theme-switch button {
    width: 36px;
    padding: 0;
  }
}
</style>
