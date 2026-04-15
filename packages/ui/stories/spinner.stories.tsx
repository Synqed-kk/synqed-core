import type { Meta, StoryObj } from '@storybook/react'
import { Spinner } from '../src/components/spinner'

const meta: Meta<typeof Spinner> = {
  title: 'Components/Spinner',
  component: Spinner,
  argTypes: { size: { control: 'select', options: ['sm', 'md', 'lg'] } },
}
export default meta
type Story = StoryObj<typeof Spinner>

export const Small: Story = { args: { size: 'sm' } }
export const Medium: Story = { args: { size: 'md' } }
export const Large: Story = { args: { size: 'lg' } }
