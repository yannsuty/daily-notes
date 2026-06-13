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
import { parseThoughtsFromDays } from './parse-thoughts';
import type { ThoughtLink, ThoughtNode } from './parse-thoughts';
import { todayKey } from './types';

interface SimNode extends SimulationNodeDatum, ThoughtNode {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

type SimLink = SimulationLinkDatum<SimNode>;

export interface MindMapOptions {
  container: HTMLElement;
  onNavigateToDay?: (dateKey: string) => void;
}

export class MindMap {
  private container: HTMLElement;
  private onNavigateToDay?: (dateKey: string) => void;
  private wrapper: HTMLElement;
  private svg: SVGSVGElement;
  private simulation: Simulation<SimNode, SimLink> | null = null;
  private zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
  private resizeObserver: ResizeObserver;

  constructor(options: MindMapOptions) {
    this.container = options.container;
    this.onNavigateToDay = options.onNavigateToDay;

    this.container.innerHTML = '';
    this.container.className = 'mindmap';

    const toolbar = document.createElement('div');
    toolbar.className = 'mindmap__toolbar';

    const legend = document.createElement('div');
    legend.className = 'mindmap__legend';
    legend.innerHTML = `
      <span class="mindmap__legend-item mindmap__legend-item--recent">Pensées récentes (7 jours)</span>
      <span class="mindmap__legend-item mindmap__legend-item--past">Pensées passées</span>
    `;

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'btn btn--ghost mindmap__refresh';
    refreshBtn.textContent = 'Actualiser';
    refreshBtn.addEventListener('click', () => void this.refresh());

    toolbar.appendChild(legend);
    toolbar.appendChild(refreshBtn);

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'mindmap__canvas';

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'mindmap__svg');
    this.wrapper.appendChild(this.svg);

    this.container.appendChild(toolbar);
    this.container.appendChild(this.wrapper);

    this.resizeObserver = new ResizeObserver(() => this.fitView());
    this.resizeObserver.observe(this.wrapper);
  }

  async init(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const days = await getAllDays();
    const graph = parseThoughtsFromDays(days, todayKey());
    this.render(graph);
  }

  private render(graph: { nodes: ThoughtNode[]; links: ThoughtLink[] }): void {
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }

    this.svg.innerHTML = '';

    if (graph.nodes.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'mindmap__empty';
      empty.textContent =
        'Aucune pensée structurée. Utilisez #tags, [[concepts]] et ## titres dans votre journal.';
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

    const linkEls = links.map(() => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'mindmap__link');
      linkGroup.appendChild(line);
      return line;
    });

    const nodeEls = nodes.map((node) => {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', `mindmap__node mindmap__node--${node.type}${node.recent ? ' mindmap__node--recent' : ' mindmap__node--past'}`);
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

      group.addEventListener('click', () => {
        if (node.type === 'day' && node.dateKey) {
          this.onNavigateToDay?.(node.dateKey);
        } else if (node.dateKey) {
          this.onNavigateToDay?.(node.dateKey);
        }
      });

      nodeGroup.appendChild(group);
      return group;
    });

    this.simulation = forceSimulation(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(80)
          .strength(0.4),
      )
      .force('charge', forceManyBody().strength(-200))
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => nodeRadius(d) + 8),
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
    this.fitView();
  }

  private fitView(): void {
    if (!this.zoomBehavior) return;
    const width = this.wrapper.clientWidth;
    const height = this.wrapper.clientHeight;
    if (width && height) {
      select(this.svg)
        .call(this.zoomBehavior.transform, zoomIdentity.translate(width / 2, height / 2).scale(0.9));
    }
  }

  destroy(): void {
    this.simulation?.stop();
    this.resizeObserver.disconnect();
  }
}

function nodeRadius(node: ThoughtNode): number {
  if (node.type === 'day') return node.recent ? 22 : 16;
  if (node.type === 'theme') return node.recent ? 14 : 10;
  return node.recent ? 12 : 8;
}

function truncateLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 16)}…` : label;
}
