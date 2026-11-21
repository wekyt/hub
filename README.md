# Wekyt Hub

Agent teams that build, maintain, and support software. Zero humans in the loop.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/wekyt/hub/main/install.sh | bash
```

One command, zero questions. It installs the default dev team into an `ai/` folder in your current project. No git clone, no npm. It needs only `curl` and `tar`, and no API keys: your agent harness provides the model access.

## What you get

**1. The dev team.** Five specialized agents, plain Markdown files, no framework:

- **Orchestrator:** makes the brief, the plan and the architecture assignment, delegates, and runs the merge step.
- **Architect:** produces the architecture, nothing else.
- **Dev:** builds the code and opens the pull request.
- **QA:** runs objective tests as the gate. It cannot open a pull request.
- **Security:** reviews. It does not approve its own findings.

**2. The flow.** Every job follows the same mandatory flow: brief, plan, architecture, build, QA. No step is skipped.

**3. The tool store.** Tools live in one shared store, apart from the agents. No agent owns a tool. Each agent finds the tool it needs by its description when the task calls for it, and each role has its own permissions. The QA agent, for example, cannot open a pull request even though the tool exists. Least privilege by role, not by trust.

**4. The merge gate.** No human in the loop. When every layer agrees, the merge happens on its own, with automatic rollback and a full audit of every decision.

## Layout

```
ai/
  README.md        the kit: layout, team, flow, tool store, merge gate
  CONTEXT.md       repo map, filled by the orchestrator on the first run
  agents/          the 5 agents, one .md file each
  skills/          Markdown skills the team loads by description
  tools/           the tool registry and the per-role permissions
  templates/       brief, plan and architecture templates
```

## How it works

Run the install command in your project folder. Then open the project with your agent harness and ask the orchestrator for the first job. The orchestrator reads the repo map (tree, README, manifest), writes it into `ai/CONTEXT.md`, then runs the flow: brief, plan, architecture, build, QA.

The installer downloads the latest release package (`wekyt-hub.tar.gz`) from this repo and extracts the `ai/` folder. To reinstall, move `ai/` aside first, or run with `WEKYT_FORCE=1` to replace it. Note that replacing `ai/` also replaces your `CONTEXT.md` and your skills, so keep them safe first.

## Status

Phase 1 is done: the dev team, the tool store, the templates, the installer. Next: multi-model support and observability, then the CI team and the router.

## Support

If wekyt helps you, you can support the project here: https://buymeacoffee.com/supportprojects

## From

Built by the Píldora Tech crew: https://www.youtube.com/@PildoraTech

---

## En español

# Wekyt Hub

Equipos de agentes que construyen, mantienen y dan soporte a software. Ningún humano en el loop.

## Instalación

```bash
curl -fsSL https://raw.githubusercontent.com/wekyt/hub/main/install.sh | bash
```

Un comando, cero preguntas. Instala el equipo dev por defecto en una carpeta `ai/` dentro de tu proyecto. Sin git clone, sin npm. Solo necesita `curl` y `tar`, y no pide claves de API: el acceso al modelo lo pone tu harness de agentes.

## Qué instala

**1. El equipo dev.** Cinco agentes especializados, archivos Markdown planos, sin framework:

- **Orquestador:** hace el brief, el plan y el encargo de arquitectura, delega, y ejecuta el paso de merge.
- **Arquitecto:** produce la arquitectura, nada más.
- **Dev:** construye el código y abre el pull request.
- **QA:** corre tests objetivos como puerta. No puede abrir un pull request.
- **Seguridad:** revisa. No aprueba sus propios hallazgos.

**2. El flujo.** Cada trabajo sigue el mismo flujo obligatorio: brief, plan, arquitectura, build, QA. Ningún paso se salta.

**3. El almacén de tools.** Las herramientas viven en un almacén compartido, aparte de los agentes. Ningún agente es dueño de una herramienta. Cada agente busca la que necesita por su descripción cuando la tarea lo pide, y cada rol tiene sus propios permisos. El agente de QA, por ejemplo, no puede abrir un pull request aunque la herramienta exista. Mínimo privilegio por rol, no por confianza.

**4. El merge gate.** Ningún humano en el loop. Cuando todas las capas acuerdan, el merge pasa solo, con rollback automático y auditoría completa de cada decisión.

## Estructura

```
ai/
  README.md        el kit: estructura, equipo, flujo, almacén de tools, merge gate
  CONTEXT.md       mapa del repo, lo llena el orquestador en la primera corrida
  agents/          los 5 agentes, un archivo .md cada uno
  skills/          skills en Markdown que el equipo carga por descripción
  tools/           el registro de tools y los permisos por rol
  templates/       plantillas de brief, plan y arquitectura
```

## Cómo funciona

Corré el comando de instalación en la carpeta de tu proyecto. Después abrí el proyecto con tu harness de agentes y pedile al orquestador el primer trabajo. El orquestador lee el mapa del repo (árbol, README, manifiesto), lo escribe en `ai/CONTEXT.md`, y después corre el flujo: brief, plan, arquitectura, build, QA.

El instalador descarga el paquete de la última release (`wekyt-hub.tar.gz`) de este repo y extrae la carpeta `ai/`. Para reinstalar, mové `ai/` a un lado primero, o corré con `WEKYT_FORCE=1` para reemplazarla. Ojo que reemplazar `ai/` también reemplaza tu `CONTEXT.md` y tus skills, así que guardalos antes.

## Estado

La Fase 1 está lista: el equipo dev, el almacén de tools, las plantillas, el instalador. Sigue: soporte multi-modelo y observabilidad, después el equipo de CI y el router.

## Apoyo

Si wekyt te sirve, podés apoyar el proyecto acá: https://buymeacoffee.com/supportprojects

## De

Hecho por el equipo de Píldora Tech: https://www.youtube.com/@PildoraTech
