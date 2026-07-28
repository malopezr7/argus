// @ts-check
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://argus-hermes.pages.dev',
	integrations: [
		starlight({
			title: 'Argus',
			description:
				'Run React Native tests on the standalone Hermes VM — the real production engine, at unit-test cost. No Metro, no native build, no device.',
			tagline: 'Your tests, on the engine that ships.',
			customCss: ['./src/styles/global.css'],
			favicon: '/favicon.svg',
			lastUpdated: true,
			pagination: true,
			tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/malopezr7/argus',
				},
			],
			editLink: {
				baseUrl: 'https://github.com/malopezr7/argus/edit/main/website/',
			},
			expressiveCode: {
				themes: ['github-dark-default', 'github-light'],
				styleOverrides: {
					borderRadius: '0.5rem',
					borderColor: 'var(--sl-color-gray-5)',
					codeFontSize: '0.85rem',
				},
			},
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'What is Argus', slug: 'start/introduction' },
						{
							label: 'Why Hermes, not Node',
							slug: 'start/why-hermes',
							badge: { text: 'context', variant: 'note' },
						},
						{ label: 'Installation', slug: 'start/installation' },
						{ label: 'Quick start', slug: 'start/quickstart' },
						{ label: 'Core concepts', slug: 'start/concepts' },
					],
				},
				{
					label: 'Writing tests',
					items: [
						{ label: 'Test structure', slug: 'tests/structure' },
						{ label: 'Matchers', slug: 'tests/matchers' },
						{ label: 'Async tests', slug: 'tests/async' },
						{ label: 'Mocks & spies', slug: 'tests/mocks' },
						{ label: 'Native modules', slug: 'tests/native-modules' },
						{ label: 'Component testing', slug: 'tests/components' },
					],
				},
				{
					label: 'Hermes',
					items: [
						{ label: 'Legacy and V1 engines', slug: 'hermes/engines' },
						{
							label: 'React Native version table',
							slug: 'hermes/versions',
							badge: { text: 'table', variant: 'tip' },
						},
						{ label: 'How the binary is provisioned', slug: 'hermes/provisioning' },
						{ label: 'Prebuilt binaries', slug: 'hermes/prebuilts' },
						{ label: 'The syntax envelope', slug: 'hermes/syntax-envelope' },
					],
				},
				{
					label: 'The CLI',
					items: [
						{ label: 'Command and flags', slug: 'cli/usage' },
						{ label: 'Reporting and exit codes', slug: 'cli/reporting' },
					],
				},
				{
					label: 'Internals',
					items: [
						{ label: 'Architecture', slug: 'internals/architecture' },
						{ label: 'The result protocol', slug: 'internals/result-protocol' },
						{ label: 'Source maps', slug: 'internals/source-maps' },
						{ label: 'Package map', slug: 'internals/packages' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Limitations & non-goals', slug: 'reference/limitations' },
						{ label: 'Roadmap', slug: 'reference/roadmap' },
						{ label: 'Contributing', slug: 'reference/contributing' },
					],
				},
			],
		}),
	],
	vite: { plugins: [tailwindcss()] },
});
