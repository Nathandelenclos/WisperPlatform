/**
 * Règle de dépendance, vérifiée par la machine (grace.architecture.dependency-rule).
 * Les flèches vont vers l'intérieur : interface -> application -> domain,
 * infrastructure -> domain/application (elle implémente les ports).
 * Les `*.module.ts` sont la racine de composition : eux seuls câblent les adaptateurs.
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-stays-pure',
      severity: 'error',
      comment: 'Le domaine ne dépend de rien : ni couche externe, ni framework, ni ORM.',
      from: { path: '^src/[^/]+/domain/' },
      to: {
        pathNot: '^src/[^/]+/domain/',
      },
    },
    {
      name: 'application-never-reaches-out',
      severity: 'error',
      comment: "L'application ne connaît que le domaine et ses propres ports.",
      from: { path: '^src/[^/]+/application/' },
      to: { path: '^src/([^/]+)/(infrastructure|interface)/' },
    },
    {
      name: 'controllers-never-touch-infrastructure',
      severity: 'error',
      comment: "L'interface passe par l'application ; seul le module de composition câble l'infra.",
      from: { path: '^src/[^/]+/interface/', pathNot: '\\.module\\.ts$' },
      to: { path: '^src/([^/]+)/infrastructure/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Pas de cycle de dépendance.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { orphan: true, pathNot: '\\.d\\.ts$' },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.spec\\.ts$' },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
