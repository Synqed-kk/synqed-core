import type { Meta, StoryObj } from '@storybook/react'
import { Button } from '../src/components/button'
import { Input } from '../src/components/input'
import { Card, CardTitle, CardValue, CardDescription } from '../src/components/card'
import { Avatar } from '../src/components/avatar'
import { Spinner } from '../src/components/spinner'
import { Skeleton } from '../src/components/skeleton'

const meta: Meta = {
  title: 'Theme/Showcase',
}
export default meta
type Story = StoryObj

export const AllComponents: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 600 }}>
      <section>
        <h3 style={{ color: 'var(--color-text)', fontSize: 14, fontWeight: 600, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'JetBrains Mono, monospace' }}>Buttons</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Delete</Button>
          <Button variant="chrome">Chrome</Button>
        </div>
      </section>

      <section>
        <h3 style={{ color: 'var(--color-text)', fontSize: 14, fontWeight: 600, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'JetBrains Mono, monospace' }}>Inputs</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input label="Customer Name" placeholder="田中太郎" />
          <Input label="Email" placeholder="tanaka@email.com" />
        </div>
      </section>

      <section>
        <h3 style={{ color: 'var(--color-text)', fontSize: 14, fontWeight: 600, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'JetBrains Mono, monospace' }}>Cards</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Card><CardTitle>Bookings</CardTitle><CardValue>5</CardValue><CardDescription>today</CardDescription></Card>
          <Card><CardTitle>Clients</CardTitle><CardValue>47</CardValue><CardDescription>total</CardDescription></Card>
        </div>
      </section>

      <section>
        <h3 style={{ color: 'var(--color-text)', fontSize: 14, fontWeight: 600, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'JetBrains Mono, monospace' }}>Avatars</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Avatar initials="TT" color="#c8873e" size="sm" />
          <Avatar initials="SH" color="#6366f1" />
          <Avatar initials="YK" color="#22c55e" size="lg" />
          <Avatar initials="IM" color="#ec4899" size="xl" />
        </div>
      </section>

      <section>
        <h3 style={{ color: 'var(--color-text)', fontSize: 14, fontWeight: 600, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'JetBrains Mono, monospace' }}>Loading</h3>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Spinner size="sm" />
          <Spinner size="md" />
          <Spinner size="lg" />
          <Skeleton style={{ width: 200, height: 20 }} />
        </div>
      </section>
    </div>
  ),
}
