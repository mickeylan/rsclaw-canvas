<template>
  <a-config-provider :theme="themeConfig" :locale="locale">
    <router-view />
  </a-config-provider>
</template>

<script setup>
import { computed } from 'vue'
import { theme as antTheme } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { useAppearanceStore } from './stores/appearance'

const locale = zhCN
const appearance = useAppearanceStore()
const themeConfig = computed(() => {
  const dark = appearance.isDark
  const primary = dark ? '#16d8c7' : '#0f9f95'
  const container = dark ? '#121821' : '#ffffff'
  const elevated = dark ? '#161e29' : '#ffffff'
  const border = dark ? '#25303d' : '#ccd8dd'

  return {
    algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: primary,
      colorInfo: primary,
      colorBgBase: dark ? '#0b0f14' : '#f5f7f8',
      colorBgContainer: container,
      colorBgElevated: elevated,
      colorTextBase: dark ? '#edf7f6' : '#17252c',
      colorTextSecondary: dark ? '#93a4b5' : '#657680',
      colorBorder: border,
      colorBorderSecondary: dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(20, 50, 60, 0.1)',
      controlHeight: 40,
      controlHeightSM: 32,
      borderRadius: 10,
      borderRadiusLG: 14,
      fontSize: 14,
      lineWidth: 1,
      boxShadowSecondary: dark
        ? '0 18px 50px rgba(0, 0, 0, 0.36)'
        : '0 18px 50px rgba(35, 57, 65, 0.14)',
      wireframe: false
    },
    components: {
      Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        fontWeight: 600
      },
      Input: {
        activeBorderColor: primary,
        hoverBorderColor: primary,
        activeShadow: `0 0 0 3px ${dark ? 'rgba(22, 216, 199, 0.12)' : 'rgba(15, 159, 149, 0.12)'}`
      },
      Select: {
        activeBorderColor: primary,
        hoverBorderColor: primary,
        optionSelectedBg: dark ? 'rgba(22, 216, 199, 0.12)' : 'rgba(15, 159, 149, 0.1)',
        optionSelectedColor: dark ? '#edf7f6' : '#17252c',
        selectorBg: dark ? '#0d141c' : '#f7f9fa'
      },
      Modal: {
        contentBg: elevated,
        headerBg: elevated
      }
    }
  }
})
</script>
