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
      comment:
        "Le domaine ne dépend de rien : ni couche externe, ni framework, ni ORM, ni module de " +
        'plateforme — et pas davantage du domaine d\'un autre contexte borné.',
      from: { path: '^src/([^/]+)/domain/' },
      to: { pathNot: '^src/$1/domain/' },
    },
    {
      name: 'application-never-reaches-out',
      severity: 'error',
      comment: "L'application ne connaît que le domaine et ses propres ports.",
      from: { path: '^src/[^/]+/application/' },
      to: { path: '^src/([^/]+)/(infrastructure|interface)/' },
    },
    {
      name: 'application-stays-technology-free',
      severity: 'error',
      comment:
        "L'application n'importe aucun paquet ni module de plateforme : c'est l'absence de " +
        'cette règle qui avait laissé `node:http` entrer dans un port. Seule exception, ' +
        'assumée et nommée : `node:stream`, dont le type `Readable` décrit le contrat de ' +
        "lecture d'un média (voir le port MediaStorage).",
      from: { path: '^src/[^/]+/application/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'core'],
        pathNot: '^stream$',
      },
    },
    {
      name: 'controllers-never-touch-infrastructure',
      severity: 'error',
      comment: "L'interface passe par l'application ; seul le module de composition câble l'infra.",
      from: { path: '^src/[^/]+/interface/' },
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
