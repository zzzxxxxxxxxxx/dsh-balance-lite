<div align="center">

<img src="assets/icon.svg" alt="dsh-balance-lite" width="84" height="84">

# dsh-balance-lite

**DeepSeek Harness 的裸余额读数 —— 只调一次 API，显示平台自己的数字。**

[![npm](https://img.shields.io/npm/v/@zzxxxxxx/dsh-balance-lite.svg)](https://www.npmjs.com/package/@zzxxxxxx/dsh-balance-lite)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-%E2%89%A5%200.2.0--rc.1-6E56CF)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.en.md) | **中文**

</div>

## 简介

- **只读一个数**：药丸显示的就是平台返回的 `total_balance`，原样两位小数，不做任何换算。
- **不估算**：没有 token 记账、没有消耗推算、没有峰谷定价、没有校正系数、没有 ETA。这是刻意的——估算要跟结算滞后、峰谷切换、缓存命中率打交道，误差由插件承担；这个插件把那份判断还给你。
- **滞后是平台的，不是插件的**：余额只在平台结算后才变，轮询再快也改不了那 1~5 分钟。所以默认 30 秒已经足够，比这更密只是白打请求。
- **失败绝不等零**：读不到时保留上一次成功读数并把状态点转黄；首次读数之前显示「读取中」；密钥没配好显示「未配置密钥」。**永远不会有「余额 0」这种由失败造出来的结论。**
- **不落盘**：`$DSH_HOME` 下不创建任何目录。代价是重启后药丸先显示「读取中」约一秒。
- **输入框下方的药丸**：紧跟宿主自带的 token 统计。悬停会弹出当前余额与读取时间，但药丸本身**不变灰**——宿主把 hover 底色留给会开面板的按钮形态，静态读数药丸保持原色（见 `StatsPills.module.css` 里那条注释），本插件遵循后者。点击也没有行为，所以它是个 `span` 而不是 `button`。

host 半独占凭据与出网，只把一份快照经**一条**路由交给浏览器半：凭据从不进入浏览器，路由参与宿主的 Host/Origin + cookie 信任围栏。没有任何定时落盘、没有历史累积。

## 安装

要求：DeepSeek Harness ≥ `0.2.0-rc.1` 且 < `0.3.0`，Node `^22.19.0 || >=24.0.0`。

**从 npm 装**（推荐）：

```sh
dsh plugin --profile <profile> add @zzxxxxxx/dsh-balance-lite
```

**从源码装 / 本地开发**：

```sh
git clone https://github.com/zzzxxxxxxxxxx/dsh-balance-lite && cd dsh-balance-lite
npm install        # 构建依赖，首次需要网络
npm run build      # 产出 lib/（插件入口；仓库里不提交构建产物）

dsh plugin --profile <profile> add "$PWD"
```

**从打好的 tarball 装**（`npm pack` 的产物已含 `lib/`，无需构建）：

```sh
dsh plugin --profile <profile> add ./zzxxxxxx-dsh-balance-lite-0.1.2.tgz
```

装完后**重启** `dsh`（profile 在启动时组合）。

- API Key 取自凭据引用 `DEEPSEEK_API_KEY`，与内置 `deepseek-official` provider 是同一个引用——模型能用就说明它已配好；也可在 **设置 → 模型**、`$DSH_HOME/.credentials.yaml` 或导出环境变量里设置。
- 更新：源码装则 `git pull && npm install && npm run build`，tarball 装则重新 `add` 一次。之后都要重启。
- 卸载：`dsh plugin --profile <p> remove @zzxxxxxx/dsh-balance-lite`，再重启。
- ⚠️ npm 上**无 scope** 的 `dsh-balance-lite` 是**另一个**包，请按 scope 安装。
- 与 `@zzxxxxxx/dsh-balance` 同时安装会并排出现两个余额药丸、各自轮询同一个端点（两者命名空间已隔离，技术上不冲突）。它俩是同一件事的两种做法，建议只留一个。
- 开发：`npm run typecheck`、`npm test`（71 个用例，不访问网络）、`npm run build`。`locale/*.json` 只承载插件管理器的显示名称与说明（`meta`），**不是**客户端字典——客户端文案在 `src/client/locales.ts`。

## 用法

- **药丸**：显示 `¥36.35`。状态点：绿=刚刚读到、黄=显示的是旧读数（超过 `staleAfterMs`，或最近一次轮询失败）、红=拿不到数（密钥问题或网络不通）、灰=还在等第一次读数。
- **悬停**：弹出「当前余额 ¥36.35，读取于 3 分钟前」，药丸外观不变（理由见上）。读取时间由读数自己的主机时间戳加上最后一次成功轮询测得的时钟偏差算出来，所以浏览器时钟漂移不会让新读数显得旧。
- **只有一条路由**：`GET /dsh-balance-lite/state`。没有刷新按钮，也没有斜杠命令——想立刻刷新就重载页面或用宿主的重载。
- 药丸是**会话作用域**（`conversation.composer.dock` 的性质），因此新建会话首页与会话之外看不到它。

## 配置

全部字段都写在插件行的 `config:` 里（本插件**没有**设置页），改完需重启。下面是完整的默认值：

```yaml
- insert:
    - id: dsh-balance-lite
      name: '@zzxxxxxx/dsh-balance-lite'
      config:
        apiKeyEnv: DEEPSEEK_API_KEY
        apiOrigin: https://api.deepseek.com
        balancePath: /user/balance
        refreshIntervalMs: 30000          # 轮询平台的周期
        requestTimeoutMs: 10000
        preferredCurrency: auto           # auto | CNY | USD
        staleAfterMs: 180000              # 超过这么久没读到新数就把药丸标为旧
        clientPollIntervalMs: 15000       # 浏览器读取快照的周期
        allowLoopbackHttp: false          # 只在本地开发时打开
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 取 API Key 的凭据引用（环境变量名） |
| `apiOrigin` | `https://api.deepseek.com` | 余额端点 origin；必须 https（loopback 例外） |
| `balancePath` | `/user/balance` | 余额端点路径 |
| `refreshIntervalMs` | `30000` | 轮询平台的周期；比这更密不会让数字更新，只会多打请求 |
| `requestTimeoutMs` | `10000` | 单次请求超时 |
| `preferredCurrency` | `auto` | 多钱包时选哪个：`auto` 优先有余额的，否则第一条 |
| `staleAfterMs` | `180000` | 读数超过这个年龄就标为旧（状态点转黄） |
| `clientPollIntervalMs` | `15000` | 浏览器读取快照的周期 |
| `allowLoopbackHttp` | `false` | 是否允许 http 的 loopback 端点（本地开发） |

几条语义：

- **平台结算滞后 1~5 分钟**：这不是插件的缺陷，是余额接口本身的性质。药丸显示的是平台最后一次结算后的数字；你刚花掉的钱要等下一轮结算才会体现在里面。
- **状态点比数字更重要**：金额只有配好密钥且网络通时才有意义，所以「这个数是新的吗」由状态点和悬停里的读取时间负责传达，而不是靠数字本身猜。
- **`preferredCurrency` 只在多钱包账户上起作用**：`auto` 先找有余额的 CNY，再找有余额的 USD，都没有就取第一条——不会在零余额的情况下悄悄换币种；指定的币种在账户里根本不存在时也按同样顺序回落，而不是把药丸留空。
- **`allowLoopbackHttp` 只给本地开发用**：打开它才允许 `http://127.0.0.1` 之类的端点，正式端点必须 https。
- **凭据只在 host 半**：浏览器拿到的快照里没有任何密钥材料，路由也必须通过宿主的信任校验（无 cookie 一律 401）。
- 本插件仍在早期，可能还有 bug。遇到问题请到 [Issues](https://github.com/zzzxxxxxxxxxx/dsh-balance-lite/issues) 反馈，并附上药丸上的文字与状态点颜色——那两项就能区分「没配密钥」「网络不通」「平台拒绝」三种情况。
