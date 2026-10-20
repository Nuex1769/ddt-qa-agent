import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function sourceFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(root, path))
    else if ([...SOURCE_EXTENSIONS].some((extension) => entry.name.endsWith(extension))) files.push(path)
  }
  return files
}

function hasNativeDateInput(source) {
  return /<input\b[^>]*\btype=["']?(?:date|datetime-local|time|month|week)["']?[^>]*>/i.test(source)
}

export async function audit(projectRoot) {
  const root = resolve(projectRoot)
  const sourceRoot = resolve(root, 'src')
  const tableComponent = process.env.CONSOLE_TABLE_COMPONENT || 'DataTable'
  const hasSharedTable = new RegExp(`\\b${escapeRegExp(tableComponent)}\\b`)
  const errors = []
  const warnings = []
  let files = []

  try {
    if (!(await stat(sourceRoot)).isDirectory()) errors.push('缺少 src 目录。')
    else files = await sourceFiles(sourceRoot)
  } catch {
    errors.push('无法读取 src 目录。')
  }

  const records = await Promise.all(files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })))
  const appFiles = records.filter(({ path }) => !path.includes('/components/ui/') && !/\.(?:test|spec)\.[tj]sx?$/.test(path))
  const joined = records.map(({ source }) => source).join('\n')
  const appJoined = appFiles.map(({ source }) => source).join('\n')
  const packagePath = resolve(root, 'package.json')
  let packageJson = {}

  try { packageJson = JSON.parse(await readFile(packagePath, 'utf8')) } catch { errors.push('缺少或无法解析 package.json。') }

  for (const { path, source } of appFiles) {
    const name = relative(root, path)
    if (/<select\b/.test(source)) errors.push(`${name}: 使用了原生 <select>。`)
    if (hasNativeDateInput(source)) errors.push(`${name}: 使用了原生日期或时间输入。`)
    if (/\b(required|pattern|minLength|maxLength)\s*=/i.test(source)) errors.push(`${name}: 使用了浏览器原生表单约束。`)
    if (/<(?:div|tr)\b[^>]*\bonClick\s*=/.test(source) && !/(?:cursor-pointer|cursor:\s*pointer)/.test(source)) warnings.push(`${name}: 检查自定义可点击表面是否具备手型光标和键盘行为。`)
  }

  const usesSonner = /from\s+["']sonner["']/.test(joined)
  const hasToastRoot = /<\s*(?:Toaster|Sonner|ToastProvider|ToastViewport)\b/.test(joined)
  const hasToastCalls = /\btoast\.(?:success|error|message|warning|info)\s*\(/.test(joined)
  const dependencies = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) }

  if ((usesSonner || hasToastCalls) && !hasToastRoot) errors.push('检测到 toast 调用，但没有根部 toast 容器。')
  if (usesSonner && !dependencies.sonner) errors.push('引用了 sonner，但 package.json 未声明 sonner 依赖。')
  if (hasToastCalls && !usesSonner && !/useToast\s*\(/.test(joined)) warnings.push('检测到 toast 调用；确认其来自统一的项目级反馈原语。')

  for (const { path, source } of appFiles) {
    const name = relative(root, path)
    const isPaginationPrimitive = /\/(?:data-)?pagination\.[tj]sx?$/.test(path)
    if (!isPaginationPrimitive && /\b(?:DataPagination|TableFooter|TablePagination)\b/.test(source) && !hasSharedTable.test(source)) errors.push(`${name}: 直接使用了分页组件，未通过项目的共享记录表格入口 ${tableComponent}。`)
    if (/<\s*Table\b/.test(source) && !hasSharedTable.test(source) && !path.includes('/components/console/')) warnings.push(`${name}: 检查此表格是否为记录型表格；记录型表格必须通过共享入口 ${tableComponent} 渲染。`)
  }

  try { await stat(resolve(root, 'package-lock.json')) } catch { warnings.push('未发现 package-lock.json；使用 npm 时应提交锁文件以保证依赖可复现。') }
  return { errors, warnings, scanned: appFiles.length }
}

async function main() {
  const root = process.argv[2]
  if (!root) {
    console.error('用法：node audit-console-frontend.mjs <项目根目录>')
    process.exitCode = 2
    return
  }
  const result = await audit(root)
  console.log(`已扫描 ${result.scanned} 个应用源文件。`)
  for (const warning of result.warnings) console.warn(`警告：${warning}`)
  for (const error of result.errors) console.error(`失败：${error}`)
  if (result.errors.length) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
