import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { themes, useThemeStore } from '../../../stores/themeStore'
import { useSettingsStore } from '../settingsStore'
import Select from '../../Select'
import { SegmentedControl } from '../ui'

type ThemeMode = 'light' | 'dark' | 'system'

function AppearanceTab() {
  const { currentTheme, themeMode, setTheme, setThemeMode } = useThemeStore()
  const quoteStyle = useSettingsStore(s => s.config.quoteStyle)
  const closeToTray = useSettingsStore(s => s.config.closeToTray)
  const setField = useSettingsStore(s => s.setField)

  return (
    <div className="tab-content">
      <SegmentedControl<ThemeMode>
        value={themeMode}
        onChange={setThemeMode}
        options={[
          { value: 'light', label: <><Sun size={16} /> 浅色</> },
          { value: 'dark', label: <><Moon size={16} /> 深色</> },
          { value: 'system', label: <><Monitor size={16} /> 跟随系统</> }
        ]}
      />
      <div className="theme-grid">
        {themes.map((theme) => (
          <div key={theme.id} className={`theme-card ${currentTheme === theme.id ? 'active' : ''}`} onClick={() => setTheme(theme.id)}>
            <div className="theme-preview" style={{ background: themeMode === 'dark' ? 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)' : `linear-gradient(135deg, ${theme.bgColor} 0%, ${theme.bgColor}dd 100%)` }}>
              <div className="theme-accent" style={{ background: theme.primaryColor }} />
            </div>
            <div className="theme-info">
              <span className="theme-name">{theme.name}</span>
              <span className="theme-desc">{theme.description}</span>
            </div>
            {currentTheme === theme.id && <div className="theme-check"><Check size={14} /></div>}
          </div>
        ))}
      </div>

      <h3 className="section-title" style={{ marginTop: '2rem' }}>引用消息样式</h3>
      <div className="quote-style-options">
        <label className={`radio-label ${quoteStyle === 'default' ? 'active' : ''}`}>
          <input
            type="radio"
            name="quoteStyle"
            value="default"
            checked={quoteStyle === 'default'}
            onChange={() => setField('quoteStyle', 'default')}
          />
          <div className="radio-content">
            <div className="style-preview">
              <img src="./logo.png" className="preview-avatar" alt="对方" />
              <div className="preview-bubble default">
                <div className="preview-quote">张三: 那天去爬山的照片...</div>
                <div className="preview-text">拍得真不错！</div>
              </div>
            </div>
          </div>
        </label>

        <label className={`radio-label ${quoteStyle === 'wechat' ? 'active' : ''}`}>
          <input
            type="radio"
            name="quoteStyle"
            value="wechat"
            checked={quoteStyle === 'wechat'}
            onChange={() => setField('quoteStyle', 'wechat')}
          />
          <div className="radio-content">
            <div className="style-preview">
              <img src="./logo.png" className="preview-avatar" alt="对方" />
              <div className="preview-group">
                <div className="preview-bubble wechat">拍得真不错！</div>
                <div className="preview-quote-bubble">张三: 那天去爬山的照片...</div>
              </div>
            </div>
          </div>
        </label>
      </div>

      <h3 className="section-title" style={{ marginTop: '2rem' }}>窗口关闭行为</h3>
      <Select<'tray' | 'quit'>
        style={{ maxWidth: 460 }}
        value={closeToTray ? 'tray' : 'quit'}
        onChange={(v) => setField('closeToTray', v === 'tray')}
        options={[
          {
            value: 'tray',
            label: '最小化到托盘',
            description: '点击关闭按钮后，应用将最小化到系统托盘继续运行'
          },
          {
            value: 'quit',
            label: '直接退出应用',
            description: '点击关闭按钮后，应用将完全退出'
          }
        ]}
      />
    </div>
  )
}

export default AppearanceTab
