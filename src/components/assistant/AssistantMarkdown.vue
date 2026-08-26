<template>
  <div class="assistant-markdown" :class="{ 'assistant-markdown--streaming': streaming }">
    <!-- eslint-disable-next-line vue/no-v-html -- content is sanitized with DOMPurify before rendering -->
    <div class="assistant-markdown__body" v-html="renderedContent"></div>
    <span v-if="streaming" class="assistant-markdown__cursor" aria-hidden="true"></span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { renderAssistantMarkdown } from '../../domain/assistantMarkdown'

const props = defineProps({
  content: {
    type: String,
    default: ''
  },
  streaming: {
    type: Boolean,
    default: false
  }
})

const renderedContent = computed(() =>
  DOMPurify.sanitize(renderAssistantMarkdown(props.content), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: [
      'audio',
      'button',
      'embed',
      'form',
      'iframe',
      'img',
      'input',
      'math',
      'object',
      'option',
      'select',
      'style',
      'svg',
      'textarea',
      'video'
    ],
    FORBID_ATTR: ['id', 'name', 'srcset', 'style'],
    ALLOW_DATA_ATTR: false
  })
)
</script>

<style scoped>
.assistant-markdown {
  min-width: 0;
  color: inherit;
  overflow-wrap: anywhere;
  white-space: normal;
}

.assistant-markdown__body :deep(> :first-child) {
  margin-top: 0;
}

.assistant-markdown__body :deep(> :last-child) {
  margin-bottom: 0;
}

.assistant-markdown__body :deep(p) {
  margin: 0 0 8px;
}

.assistant-markdown__body :deep(h1),
.assistant-markdown__body :deep(h2),
.assistant-markdown__body :deep(h3),
.assistant-markdown__body :deep(h4),
.assistant-markdown__body :deep(h5),
.assistant-markdown__body :deep(h6) {
  margin: 14px 0 6px;
  color: var(--text-primary);
  font-weight: 650;
  line-height: 1.4;
}

.assistant-markdown__body :deep(h1) {
  font-size: 17px;
}

.assistant-markdown__body :deep(h2) {
  font-size: 15px;
}

.assistant-markdown__body :deep(h3),
.assistant-markdown__body :deep(h4),
.assistant-markdown__body :deep(h5),
.assistant-markdown__body :deep(h6) {
  font-size: 13px;
}

.assistant-markdown__body :deep(ul),
.assistant-markdown__body :deep(ol) {
  margin: 6px 0 9px;
  padding-left: 20px;
}

.assistant-markdown__body :deep(li + li) {
  margin-top: 3px;
}

.assistant-markdown__body :deep(li > p) {
  margin: 0;
}

.assistant-markdown__body :deep(blockquote) {
  margin: 8px 0;
  padding: 5px 10px;
  border-left: 3px solid rgba(22, 216, 199, 0.7);
  color: var(--text-secondary);
  background: rgba(22, 216, 199, 0.05);
}

.assistant-markdown__body :deep(code) {
  padding: 2px 5px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 5px;
  color: #d3f9f4;
  font-family: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.92em;
  background: rgba(0, 0, 0, 0.28);
}

.assistant-markdown__body :deep(pre) {
  max-width: 100%;
  margin: 8px 0;
  padding: 10px 11px;
  overflow-x: auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: #0a1119;
}

.assistant-markdown__body :deep(pre code) {
  padding: 0;
  border: 0;
  color: #d9e4ef;
  white-space: pre;
  background: transparent;
}

.assistant-markdown__body :deep(table) {
  width: 100%;
  margin: 8px 0;
  border-collapse: collapse;
  font-size: 11px;
}

.assistant-markdown__body :deep(th),
.assistant-markdown__body :deep(td) {
  padding: 6px 8px;
  border: 1px solid var(--border-soft);
  text-align: left;
  vertical-align: top;
}

.assistant-markdown__body :deep(th) {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.04);
}

.assistant-markdown__body :deep(a) {
  color: var(--primary);
  text-decoration: underline;
  text-decoration-color: rgba(22, 216, 199, 0.45);
  text-underline-offset: 2px;
}

.assistant-markdown__body :deep(a:hover) {
  text-decoration-color: currentColor;
}

.assistant-markdown__body :deep(hr) {
  margin: 11px 0;
  border: 0;
  border-top: 1px solid var(--border-soft);
}

.assistant-markdown__body :deep(.assistant-markdown__image-label) {
  color: var(--text-secondary);
  font-style: italic;
}

.assistant-markdown__cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin: 2px 0 0 3px;
  vertical-align: -2px;
  border-radius: 1px;
  background: var(--primary);
  animation: assistant-markdown-cursor-blink 0.8s steps(2, start) infinite;
}

@keyframes assistant-markdown-cursor-blink {
  50% {
    opacity: 0;
  }
}
</style>
