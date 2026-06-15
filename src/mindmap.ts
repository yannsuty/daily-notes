import {
  drag as d3Drag,
  type D3DragEvent,
  type SubjectPosition,
} from 'd3-drag';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { getAllDays } from './db';
import {
  cacheAiThoughts,
  clearAiThoughtsCache,
  extractThoughtsWithAI,
  getCachedAiThoughts,
} from './merlin-ai';
import {
  buildThoughtGraph,
  daysFingerprint,
  formatLastSeen,
  getNeighbors,
  getTopIdeas,
} from './parse-thoughts';
import type { ThoughtGraph, ThoughtNode } from './parse-thoughts';
import { todayKey } from './types';

interface SimNode extends SimulationNodeDatum, ThoughtNode {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

type SimLink = SimulationLinkDatum<SimNode> & { weight: number };

export interface MindMapOptions {
  container: HTMLElement;
}

export class MindMap {
  private container: HTMLElement;
  private wrapper: HTMLElement;
  private svg: SVGSVGElement;
  private summaryEl: HTMLElement;
  private detailEl: HTMLElement;
  private simulation: Simulation<SimNode, SimLink> | null = null;
  private zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
  private resizeObserver: ResizeObserver;
  private currentGraph: ThoughtGraph = { nodes: [], links: [] };
  private selectedId: string | null = null;
  private cacheFingerprint = '';
  private aiGraph: ThoughtGraph | null = null;
  private aiAnalyzing = false;
  private statusEl: HTMLElement | null = null;

  constructor(options: MindMapOptions) {
    this.container = options.container;

    this.container.innerHTML = '';
    this.container.className = 'mindmap';

    const toolbar = document.createElement('div');
    toolbar.className = 'mindmap__toolbar';

    const legend = document.createElement('div');
    legend.className = 'mindmap__legend';
    legend.innerHTML = `
      <span class="mindmap__legend-item mindmap__legend-item--recent">En ce moment</span>
      <span class="mindmap__legend-item mindmap__legend-item--past">Passé</span>
      <span class="mindmap__legend-item mindmap__legend-item--word">Mots</span>
      <span class="mindmap__legend-item mindmap__legend-item--concept">Concepts</span>
    `;

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'btn btn--ghost mindmap__refresh';
    refreshBtn.textContent = 'Actualiser';
    refreshBtn.addEventListener('click', () => void this.refresh());

    toolbar.appendChild(legend);
    toolbar.appendChild(refreshBtn);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'mindmap__status';
    this.statusEl.hidden = true;

    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'mindmap__summary';

    this.detailEl = document.createElement('div');
    this.detailEl.className = 'mindmap__detail';
    this.detailEl.hidden = true;

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'mindmap__canvas';

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'mindmap__svg');
    this.wrapper.appendChild(this.svg);

    this.container.appendChild(toolbar);
    this.container.appendChild(this.statusEl);
    this.container.appendChild(this.summaryEl);
    this.container.appendChild(this.wrapper);
    this.container.appendChild(this.detailEl);

    this.resizeObserver = new ResizeObserver(() => this.fitView());
    this.resizeObserver.observe(this.wrapper);
  }

  async init(): Promise<void> {
    await this.refresh();
  }

  async resetAiAnalysis(): Promise<void> {
    clearAiThoughtsCache();
    this.aiGraph = null;
    this.cacheFingerprint = '';
    this.currentGraph = { nodes: [], links: [] };
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const days = await getAllDays();
    const fingerprint = daysFingerprint(days);
    const cachedAi = getCachedAiThoughts(fingerprint);
    const hasContent = Object.values(days).some((d) => d.content.trim());

    if (fingerprint === this.cacheFingerprint && this.currentGraph.nodes.length > 0) {
      this.renderSummary(this.currentGraph);
      this.render(this.currentGraph);
      if (!cachedAi && !this.aiGraph && hasContent) {
        void this.runAutoAiAnalysis(days, fingerprint);
      }
      return;
    }

    this.aiGraph = cachedAi;
    this.currentGraph = buildThoughtGraph(days, todayKey(), this.aiGraph);
    this.cacheFingerprint = fingerprint;
    this.renderSummary(this.currentGraph);
    this.render(this.currentGraph);

    if (!this.aiGraph && hasContent) {
      void this.runAutoAiAnalysis(days, fingerprint);
    }
  }

  private setAnalysisStatus(message: string): void {
    if (!this.statusEl) return;
    if (message) {
      this.statusEl.textContent = message;
      this.statusEl.hidden = false;
    } else {
      this.statusEl.textContent = '';
      this.statusEl.hidden = true;
    }
  }

  private async runAutoAiAnalysis(
    days: Record<string, { content: string }>,
    fingerprint: string,
  ): Promise<void> {
    if (this.aiAnalyzing) return;
    this.aiAnalyzing = true;
    this.setAnalysisStatus('Merlin analyse vos notes…');

    const result = await extractThoughtsWithAI(days, todayKey());
    this.aiAnalyzing = false;
    this.setAnalysisStatus('');

    if (fingerprint !== this.cacheFingerprint) return;

    if (!result.ok || !result.graph) return;

    this.aiGraph = result.graph;
    cacheAiThoughts(fingerprint, result.graph);
    this.currentGraph = buildThoughtGraph(days, todayKey(), this.aiGraph);
    this.renderSummary(this.currentGraph);
    this.render(this.currentGraph);
  }

  private renderSummary(graph: ThoughtGraph): void {
    const top = getTopIdeas(graph, 5);
    if (top.length === 0) {
      this.summaryEl.innerHTML = '';
      return;
    }

    const recent = top.filter((n) => n.recent);
    const label = recent.length > 0 ? 'Ce à quoi vous pensez en ce moment' : 'Vos idées qui reviennent';

    this.summaryEl.innerHTML = `
      <p class="mindmap__summary-title">${label}</p>
      <div class="mindmap__chips">
        ${top.map((n) => `<button type="button" class="mindmap__chip mindmap__chip--${n.type}${n.recent ? ' mindmap__chip--recent' : ''}" data-node-id="${n.id}">${escapeHtml(n.label)}</button>`).join('')}
      </div>
    `;

    for (const chip of this.summaryEl.querySelectorAll<HTMLButtonElement>('.mindmap__chip')) {
      chip.addEventListener('click', () => {
        const id = chip.dataset.nodeId;
        const node = graph.nodes.find((n) => n.id === id);
        if (node) this.showDetail(node);
      });
    }
  }

  private showDetail(node: ThoughtNode): void {
    this.selectedId = node.id;
    const neighbors = getNeighbors(this.currentGraph, node.id);

    this.detailEl.hidden = false;
    this.detailEl.innerHTML = `
      <div class="mindmap__detail-header">
        <h3 class="mindmap__detail-title">${escapeHtml(node.label)}</h3>
        <button type="button" class="mindmap__detail-close" aria-label="Fermer">×</button>
      </div>
      <p class="mindmap__detail-meta">
        ${node.count} occurrence${node.count > 1 ? 's' : ''} · Dernière fois ${formatLastSeen(node.lastSeen)}${node.recent ? ' · En ce moment' : ''}
      </p>
      ${
        neighbors.length > 0
          ? `<p class="mindmap__detail-related-title">Lié à</p>
             <div class="mindmap__chips">
               ${neighbors.map((n) => `<button type="button" class="mindmap__chip mindmap__chip--${n.type}${n.recent ? ' mindmap__chip--recent' : ''}" data-node-id="${n.id}">${escapeHtml(n.label)}</button>`).join('')}
             </div>`
          : ''
      }
    `;

    this.detailEl.querySelector('.mindmap__detail-close')!.addEventListener('click', () => {
      this.hideDetail();
    });

    for (const chip of this.detailEl.querySelectorAll<HTMLButtonElement>('.mindmap__chip')) {
      chip.addEventListener('click', () => {
        const id = chip.dataset.nodeId;
        const match = this.currentGraph.nodes.find((n) => n.id === id);
        if (match) this.showDetail(match);
      });
    }
  }

  private hideDetail(): void {
    this.selectedId = null;
    this.detailEl.hidden = true;
    this.detailEl.innerHTML = '';
  }

  private render(graph: ThoughtGraph): void {
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }

    this.svg.innerHTML = '';
    this.hideDetail();

    if (graph.nodes.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'mindmap__empty';
      empty.textContent =
        'Pas assez de texte pour dégager des idées. Écrivez un peu plus dans votre journal — les mots et concepts récurrents apparaîtront ici automatiquement.';
      this.wrapper.querySelector('.mindmap__empty')?.remove();
      this.wrapper.appendChild(empty);
      return;
    }

    this.wrapper.querySelector('.mindmap__empty')?.remove();

    const width = this.wrapper.clientWidth || 400;
    const height = this.wrapper.clientHeight || 400;

    const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    const links: SimLink[] = graph.links
      .filter((l) => nodeById.has(l.source) && nodeById.has(l.target))
      .map((l) => ({
        source: nodeById.get(l.source)!,
        target: nodeById.get(l.target)!,
        weight: l.weight,
      }));

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'mindmap__graph');
    this.svg.appendChild(g);

    const linkGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    linkGroup.setAttribute('class', 'mindmap__links');
    g.appendChild(linkGroup);

    const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodeGroup.setAttribute('class', 'mindmap__nodes');
    g.appendChild(nodeGroup);

    const linkEls = links.map((link) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'mindmap__link');
      line.setAttribute('stroke-width', String(1 + Math.min(link.weight, 4)));
      linkGroup.appendChild(line);
      return line;
    });

    const nodeEls = nodes.map((node) => {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute(
        'class',
        `mindmap__node mindmap__node--${node.type}${node.recent ? ' mindmap__node--recent' : ' mindmap__node--past'}${this.selectedId === node.id ? ' mindmap__node--selected' : ''}`,
      );
      group.style.cursor = 'pointer';

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const radius = nodeRadius(node);
      circle.setAttribute('r', String(radius));
      group.appendChild(circle);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'mindmap__label');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dy', '0.35em');
      label.textContent = truncateLabel(node.label);
      group.appendChild(label);

      group.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showDetail(node);
        for (const el of nodeEls) {
          el.classList.remove('mindmap__node--selected');
        }
        group.classList.add('mindmap__node--selected');
      });

      nodeGroup.appendChild(group);
      return group;
    });

    const maxCount = Math.max(...nodes.map((n) => n.count), 1);

    this.simulation = forceSimulation(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((link) => 100 - Math.min(link.weight * 8, 40))
          .strength((link) => 0.2 + Math.min(link.weight * 0.1, 0.5)),
      )
      .force('charge', forceManyBody().strength((d) => -120 - (d as SimNode).count * 15))
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => nodeRadius(d, maxCount) + 10),
      );

    const dragBehavior = d3Drag<SVGGElement, SimNode>()
      .on('start', (event: D3DragEvent<SVGGElement, SimNode, SimNode | SubjectPosition>, d) => {
        if (!event.active) this.simulation?.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event: D3DragEvent<SVGGElement, SimNode, SimNode | SubjectPosition>, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event: D3DragEvent<SVGGElement, SimNode, SimNode | SubjectPosition>, d) => {
        if (!event.active) this.simulation?.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    select(this.svg)
      .selectAll<SVGGElement, SimNode>('.mindmap__node')
      .data(nodes)
      .call(dragBehavior);

    this.simulation.on('tick', () => {
      links.forEach((link, i) => {
        const source = link.source as SimNode;
        const target = link.target as SimNode;
        const el = linkEls[i];
        el.setAttribute('x1', String(source.x ?? 0));
        el.setAttribute('y1', String(source.y ?? 0));
        el.setAttribute('x2', String(target.x ?? 0));
        el.setAttribute('y2', String(target.y ?? 0));
      });

      nodes.forEach((node, i) => {
        const el = nodeEls[i];
        el.setAttribute('transform', `translate(${node.x ?? 0},${node.y ?? 0})`);
      });
    });

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        g.setAttribute('transform', event.transform.toString());
      });

    select(this.svg).call(this.zoomBehavior);
    this.svg.addEventListener('click', () => this.hideDetail());
    this.fitView();
  }

  private fitView(): void {
    if (!this.zoomBehavior) return;
    const width = this.wrapper.clientWidth;
    const height = this.wrapper.clientHeight;
    if (width && height) {
      select(this.svg)
        .call(this.zoomBehavior.transform, zoomIdentity.translate(width / 2, height / 2).scale(0.85));
    }
  }

  destroy(): void {
    this.simulation?.stop();
    this.resizeObserver.disconnect();
  }
}

function nodeRadius(node: ThoughtNode, maxCount = 1): number {
  const base =
    node.type === 'theme' ? 14
    : node.type === 'concept' ? 13
    : node.type === 'tag' ? 11
    : 10;
  const scale = 1 + (node.count / maxCount) * 1.2;
  const recentBoost = node.recent ? 1.15 : 0.85;
  return base * scale * recentBoost;
}

function truncateLabel(label: string): string {
  return label.length > 22 ? `${label.slice(0, 20)}…` : label;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
