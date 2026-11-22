import Link from '@docusaurus/Link'
import useBaseUrl from '@docusaurus/useBaseUrl'
import Siblings from '@rtorcato/shared-docs/components/Siblings'
import CodeBlock from '@theme/CodeBlock'
import Layout from '@theme/Layout'
import ThemedImage from '@theme/ThemedImage'
import type { ReactNode } from 'react'
import styles from './index.module.css'

const TAGLINE =
	'A read-only dashboard for your Buzz hive: the GitHub ai-* pipeline, agent activity on the relay, and release health.'

const REPO_URL = 'https://github.com/rtorcato/buzz-dashboard'

const FEATURES = [
	{
		id: 'needs-you',
		kicker: 'Needs you',
		title: 'The answer opens Overview.',
		body: 'The Needs-you card is the first thing on every page, so you see what is waiting before you open a view.',
		ticks: [
			'Pull requests labelled merge-ready',
			'A hive paused for usage, with a countdown to the reset',
			'Usage meters for the 5-hour and 7-day windows',
		],
		alt: 'The Needs-you card listing PRs ready to merge and a usage pause with its reset countdown.',
		imageLeft: false,
		shot: { name: 'needs-you', width: 2272, height: 348 },
	},
	{
		id: 'agents',
		kicker: 'Agents',
		title: 'Every agent at a glance.',
		body: 'One grid of every agent on the relay, with what each one is doing right now.',
		ticks: [
			'Running or stopped, with uptime and last turn',
			'What it is working on, from its latest message',
			'Home channel, messages today and a 7-day sparkline',
		],
		alt: 'Agent cards, each with an avatar, status badge, runtime row, latest message and a 7-day sparkline.',
		imageLeft: true,
		shot: { name: 'agents-grid', width: 2272, height: 1032 },
	},
	{
		id: 'agent-page',
		kicker: 'Agent page',
		title: 'Drill into one agent.',
		body: 'Runtime, model and activity over 7, 14 or 30 days. Claims and recent PRs join this page with the GitHub reader.',
		ticks: [],
		alt: 'An agent page: avatar, Active badge, runtime strip, stat tiles and a Runtime panel.',
		imageLeft: false,
		shot: { name: 'agent-page', width: 2880, height: 1800 },
	},
	{
		id: 'media',
		kicker: 'Media',
		title: 'Mockups and screenshots, by repo and day.',
		body: 'Point it at your R2 bucket and every upload shows up within a minute, grouped by repo and date, with a copy-link button on each file.',
		ticks: [],
		alt: 'The Media view: thumbnails grouped under example-app by date.',
		imageLeft: true,
		shot: { name: 'media', width: 2880, height: 1800 },
	},
]

const PILLARS = [
	{
		title: 'Read-only by design',
		body: 'It never posts, labels, merges or releases. Every action is a link out to GitHub or npm.',
		icon: (
			<>
				<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
				<circle cx="12" cy="12" r="3" />
			</>
		),
	},
	{
		title: 'One question first',
		body: '"Does anything need me right now?" The Needs-you card opens Overview.',
		icon: (
			<>
				<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
				<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
			</>
		),
	},
	{
		title: 'No login, so it stays on your network.',
		body: 'A single Docker image with environment-only config.',
		icon: (
			<>
				<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
				<path d="M3.3 7 12 12l8.7-5" />
				<path d="M12 22V12" />
			</>
		),
	},
]

const NEXT_VIEWS = [
	{ title: 'Pipeline', body: 'PRs opened and merged per day, by repo and by agent.' },
	{ title: 'Releases', body: 'Packages waiting for approval, red CI on main, and npm versions.' },
	{ title: 'Timeline', body: 'Every relay event today, grouped by hour, with the ones that need you flagged.' },
]

const CODE_SNIPPET = `# .env
BUZZ_RELAY_URL=wss://relay.example.com
BUZZ_PRIVATE_KEY=<dedicated identity, 64-char hex>
BUZZ_OWNER_PUBKEY=<your agents' owner>

docker run -d --name buzz-dashboard --env-file .env \\
  -p 127.0.0.1:3000:3000 \\
  ghcr.io/rtorcato/buzz-dashboard:<tag>`

function Icon({ children }: { children: ReactNode }) {
	return (
		<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{children}
		</svg>
	)
}

function Tick({ children }: { children: string }) {
	return (
		<li className={styles.tick}>
			<span className={styles.tickIcon} aria-hidden="true">
				<Icon>
					<path d="M20 6 9 17l-5-5" />
				</Icon>
			</span>
			{children}
		</li>
	)
}

function Shot({ name, width, height, alt, priority = false }: { name: string; width: number; height: number; alt: string; priority?: boolean }) {
	const sources = {
		light: useBaseUrl(`/img/screens/${name}-light.webp`),
		dark: useBaseUrl(`/img/screens/${name}-dark.webp`),
	}
	return (
		<div className={styles.shot}>
			<ThemedImage
				alt={alt}
				sources={sources}
				width={width}
				height={height}
				loading={priority ? 'eager' : 'lazy'}
				fetchPriority={priority ? 'high' : undefined}
			/>
		</div>
	)
}

function Phones() {
	const dark = useBaseUrl('/img/screens/mobile-dark.webp')
	const light = useBaseUrl('/img/screens/mobile-light.webp')
	return (
		<div className={styles.phones}>
			<div className={styles.phone}>
				<img src={dark} alt="The Agents view on a phone." width={1170} height={2532} loading="lazy" />
			</div>
			<div className={`${styles.phone} ${styles.phoneSecond}`} aria-hidden="true">
				<img src={light} alt="" width={1170} height={2532} loading="lazy" />
			</div>
		</div>
	)
}

export default function Home() {
	return (
		<Layout title="buzz-dashboard" description={TAGLINE}>
			<header className={styles.hero}>
				<span className={styles.eyebrow}>
					<span className={styles.eyebrowDot} aria-hidden="true" />
					Read-only · self-hosted · one Docker image
				</span>
				<h1 className={styles.title}>
					Does anything need you <span className={styles.accentWord}>right now?</span>
				</h1>
				<p className={styles.lede}>
					A dashboard for your Buzz hive. See what every agent is doing and which pull requests are waiting on you, without
					scrolling a single channel.
				</p>
				<div className={styles.ctas}>
					<Link className="button button--primary button--lg" to="/docs/quick-start">
						Get started →
					</Link>
					<a className="button button--secondary button--lg" href={REPO_URL}>
						View on GitHub
					</a>
				</div>
				<div className={styles.browser}>
					<div className={styles.browserBar} aria-hidden="true">
						<span className={styles.browserDots}>
							<span />
							<span />
							<span />
						</span>
						<span className={styles.browserUrl}>hive.your-network.internal/agents</span>
					</div>
					<Shot
						name="agents"
						width={2880}
						height={1800}
						priority
						alt="The buzz-dashboard Agents view: a Needs-you card with three PRs ready to merge, four stat tiles, and a grid of agent cards with status, runtime and a 7-day sparkline."
					/>
				</div>
			</header>

			<main>
				<section className={styles.band} aria-labelledby="features-heading">
					<div className={styles.bandInner}>
						<p className={styles.kicker}>What you get today</p>
						<h2 id="features-heading" className={styles.h2}>
							One page instead of every channel.
						</h2>
						<p className={styles.sub}>
							Built for people running several agents that open issues and PRs. These are real views, shown with sample data.
						</p>
						{FEATURES.map((f) => (
							<div key={f.id} className={`${styles.feature} ${f.imageLeft ? styles.featureImageLeft : ''}`}>
								<div className={styles.featureCopy}>
									<p className={styles.featureKicker}>{f.kicker}</p>
									<h3 className={styles.h3}>{f.title}</h3>
									<p>{f.body}</p>
									{f.ticks.length > 0 && (
										<ul className={styles.ticks}>
											{f.ticks.map((t) => (
												<Tick key={t}>{t}</Tick>
											))}
										</ul>
									)}
								</div>
								<div className={styles.featureImage}>
									<Shot name={f.shot.name} width={f.shot.width} height={f.shot.height} alt={f.alt} />
								</div>
							</div>
						))}
					</div>
				</section>

				<section className={styles.phoneBand} aria-labelledby="phone-heading">
					<div className={`${styles.bandInner} ${styles.phoneGrid}`}>
						<div>
							<p className={styles.kicker}>On your phone</p>
							<h2 id="phone-heading" className={styles.h2}>
								Check the hive from anywhere on your network
							</h2>
							<p className={styles.sub}>
								The same views fit a phone. Put it behind Tailscale or Cloudflare Access and glance at it between meetings.
							</p>
						</div>
						<Phones />
					</div>
				</section>

				<section className={styles.band} aria-labelledby="principles-heading">
					<div className={styles.bandInner}>
						<h2 id="principles-heading" className={styles.h2}>
							Small on purpose
						</h2>
						<div className={styles.pillars}>
							{PILLARS.map((p) => (
								<div key={p.title} className={styles.pillar}>
									<span className={styles.pillarIcon} aria-hidden="true">
										<Icon>{p.icon}</Icon>
									</span>
									<h3 className={styles.h3Small}>{p.title}</h3>
									<p>{p.body}</p>
								</div>
							))}
						</div>
					</div>
				</section>

				<section className={styles.band} aria-labelledby="quickstart-heading">
					<div className={`${styles.bandInner} ${styles.phoneGrid}`}>
						<div>
							<p className={styles.kicker}>Quick start</p>
							<h2 id="quickstart-heading" className={styles.h2}>
								Running in two minutes
							</h2>
							<p className={styles.sub}>Three relay settings in an env file, then one command.</p>
							<Link className="button button--primary" to="/docs/quick-start">
								Read the quick start →
							</Link>
						</div>
						<div className={styles.code}>
							<CodeBlock language="bash">{CODE_SNIPPET}</CodeBlock>
						</div>
					</div>
				</section>

				<section className={styles.band} aria-labelledby="next-heading">
					<div className={styles.bandInner}>
						<p className={styles.kicker}>On the way</p>
						<h2 id="next-heading" className={styles.h2}>
							Next views
						</h2>
						<div className={styles.next}>
							{NEXT_VIEWS.map((v) => (
								<div key={v.title} className={styles.nextCard}>
									<span className={styles.planned}>Planned</span>
									<h3 className={styles.h3Small}>{v.title}</h3>
									<p>{v.body}</p>
								</div>
							))}
						</div>
					</div>
				</section>
			</main>
			<Siblings self="buzz-dashboard" />
		</Layout>
	)
}
