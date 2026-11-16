import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentBox, ContentHeader } from '../ContentLayout';

function header(props: Partial<React.ComponentProps<typeof ContentHeader>> = {}) {
  return render(
    <ContentBox>
      <ContentHeader title="Agents" {...props} />
    </ContentBox>,
  );
}

describe('ContentHeader (one instrument bar)', () => {
  it('renders the title as the h1 and the subtitle as a quiet caption line', () => {
    header({ subtitle: '12 agents running' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Agents');
    const caption = screen.getByText('12 agents running');
    expect(caption.className).toContain('typo-caption');
  });

  it('keeps every slot on one bar row: icon, title, meta, subtitle, actions', () => {
    const { container } = header({
      icon: <svg data-testid="ico" />,
      subtitle: 'sub',
      meta: '3 / 9',
      actions: <button type="button">Act</button>,
    });
    const rows = container.querySelectorAll('.flex.items-center.gap-3');
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.querySelector('h1')).not.toBeNull();
    expect(row.querySelector('[data-testid="ico"]')).not.toBeNull();
    expect(row.textContent).toContain('3 / 9');
    expect(row.querySelector('button')).not.toBeNull();
  });

  it('is a --head-h bar with a hairline and no tinted band or uppercase caption', () => {
    const { container } = header({ subtitle: 'x' });
    const root = container.querySelector('.sticky') as HTMLElement;
    expect(root.className).toContain('border-hair');
    expect(root.className).not.toContain('bg-primary');
    expect(container.innerHTML).not.toContain('uppercase');
    expect((root.firstElementChild as HTMLElement).style.minHeight).toBe('var(--head-h)');
  });

  it('puts the toolbar on its own hairline row and still renders children', () => {
    const { container } = header({ toolbar: <span>tools</span>, children: <div>kid</div> });
    expect(screen.getByText('tools').parentElement?.className).toContain('border-t');
    expect(container.textContent).toContain('kid');
  });

  it('compact keeps its test id and stacks the subtitle under the title', () => {
    header({ compact: true, subtitle: 'meta line' });
    expect(screen.getByTestId('content-header-compact')).toBeTruthy();
    expect(screen.getByText('meta line').previousElementSibling?.tagName).toBe('H1');
  });

  it('fitWidth drops the 80vw floor', () => {
    const { container } = header({ fitWidth: true });
    expect((container.querySelector('.sticky') as HTMLElement).className).not.toContain('min-w-[80vw]');
  });
});
