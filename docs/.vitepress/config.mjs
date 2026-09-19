import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const chapters = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{2}\./.test(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))

function sidebar(locale) {
  return chapters.map(({ name }) => {
    const number = name.slice(0, 2)
    const file = locale === 'zh' ? 'Readme-zh.md' :
      readdirSync(join(root, name)).find((item) => /^readme\.md$/i.test(item))
    const heading = readFileSync(join(root, name, file), 'utf8').match(/^#\s+(.+)$/m)?.[1]
    return {
      text: heading || name,
      link: `${locale === 'zh' ? '/zh' : ''}/chapter-${number}/`
    }
  })
}

export default defineConfig({
  title: 'System Design Notes',
  description: 'System design interview notes in English and Chinese',
  cleanUrls: true,
  themeConfig: {
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/pws019/system-design-notes' }]
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [{ text: 'Home', link: '/' }],
        sidebar: sidebar('en'),
        outline: { label: 'On this page' }
      }
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [{ text: '首页', link: '/zh/' }],
        sidebar: sidebar('zh'),
        outline: { label: '本页目录' },
        docFooter: { prev: '上一章', next: '下一章' },
        search: { provider: 'local' }
      }
    }
  }
})
