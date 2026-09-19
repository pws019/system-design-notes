import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const site = join(root, 'docs')
const entries = await readdir(root, { withFileTypes: true })
const chapters = entries
  .filter((entry) => entry.isDirectory() && /^\d{2}\./.test(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))

if (chapters.length !== 28) {
  throw new Error(`Expected 28 chapter directories, found ${chapters.length}`)
}

await rm(join(site, 'index.md'), { force: true })
await rm(join(site, 'zh'), { recursive: true, force: true })
await rm(join(site, 'public', 'images'), { recursive: true, force: true })

for (const chapter of chapters) {
  const number = chapter.name.slice(0, 2)
  const slug = `chapter-${number}`
  const sourceDir = join(root, chapter.name)
  const files = await readdir(sourceDir)
  const englishFile = files.find((file) => /^readme\.md$/i.test(file))
  if (!englishFile || !files.includes('Readme-zh.md')) {
    throw new Error(`Missing English or Chinese README in ${chapter.name}`)
  }

  for (const [locale, file] of [['en', englishFile], ['zh', 'Readme-zh.md']]) {
    const targetDir = locale === 'en' ? join(site, slug) : join(site, 'zh', slug)
    await rm(targetDir, { recursive: true, force: true })
    await mkdir(targetDir, { recursive: true })
    let markdown = await readFile(join(sourceDir, file), 'utf8')
    markdown = markdown.replaceAll('./images/', `/images/${slug}/`)
    // Several source documents use decorative div wrappers with malformed
    // closing tags. They are not needed for the site layout, and Vue requires
    // valid HTML when VitePress compiles Markdown.
    markdown = markdown.replace(/^\s*<\/?div(?:\s[^>]*)?>\s*$/gm, '')
    markdown = markdown.replace(/<img\b([^>]*?)(?<!\/)\s*>/g, '<img$1 />')
    // The English source contains one stale cross-chapter link. Both locales
    // should link to the wallet chapter at its generated route.
    markdown = markdown.replaceAll('../chapter28', '/chapter-27/')
    markdown = markdown.replace(/\.\.\/27\.%20%20Digital%20Wallet\/Readme-zh\.md/g, '/zh/chapter-27/')
    await writeFile(join(targetDir, 'index.md'), markdown)
  }

  const imageDir = join(sourceDir, 'images')
  if (files.includes('images')) {
    await cp(imageDir, join(site, 'public', 'images', slug), { recursive: true })
  }
}

for (const [locale, filename] of [['en', 'Readme.md'], ['zh', 'Readme-zh.md']]) {
  let markdown = await readFile(join(root, filename), 'utf8')
  markdown = markdown.replace(/\]\(\.\/(\d{2})\.[^)]+\)/g, (_match, number) =>
    `](${locale === 'zh' ? '/zh' : ''}/chapter-${number}/)`)
  markdown = markdown.replaceAll('](./Readme-zh.md)', '](/zh/)')
  markdown = markdown.replaceAll('](./Readme.md)', '](/)')
  const target = locale === 'en' ? join(site, 'index.md') : join(site, 'zh', 'index.md')
  await mkdir(resolve(target, '..'), { recursive: true })
  await writeFile(target, markdown)
}

console.log(`Prepared ${chapters.length} chapters in English and Chinese`)
