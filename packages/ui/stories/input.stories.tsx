import type { Meta, StoryObj } from '@storybook/react'
import { Input } from '../src/components/input'

const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
}
export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = { args: { placeholder: 'Search customers...' } }
export const WithLabel: Story = { args: { label: 'Customer Name', placeholder: '田中太郎' } }
export const WithError: Story = { args: { label: 'Email', value: 'invalid', error: 'Invalid email address' } }
export const Disabled: Story = { args: { label: 'Disabled', value: 'Cannot edit', disabled: true } }
