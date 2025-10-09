# SAMARITAN Roadmap

---

## ✅ Phase 1: MVP - Documentation & Validation (COMPLETED)

**Goal**: YAML-based operation definitions with manual generation

### Shipped Features
- ✅ YAML operation parser with environment support
- ✅ JSON Schema validation with strict mode
- ✅ Manual generation (Markdown format)
- ✅ Confluence documentation generation (ADF format)
- ✅ Git metadata integration in generated manuals
- ✅ Variable resolution (--resolve-vars flag)
- ✅ Multi-environment support
- ✅ Evidence requirement models
- ✅ Template-based operation creation
- ✅ Comprehensive test suite (154 tests passing)

### Documentation
- ✅ README.md with examples and workflows
- ✅ USAGE.md for quick reference
- ✅ CLI help system
- ✅ Example operation files

---

## 🚧 Phase 2: Execution & Evidence Collection (PLANNED)

**Goal**: Execute operations and automatically collect evidence

### 2.1 Command Execution Engine
- [ ] Execute `type: automatic` steps with command runner
- [ ] Capture stdout/stderr from command execution
- [ ] Timeout handling and process management
- [ ] Exit code validation
- [ ] Retry logic with configurable attempts
- [ ] Environment variable interpolation in commands
- [ ] Working directory management
- [ ] Command output streaming

**Priority**: HIGH
**Complexity**: Medium
**Estimated**: 2-3 weeks

### 2.2 Automatic Evidence Collection
- [ ] **Screenshot capture**: Automatic screen capture for GUI operations
- [ ] **Command output capture**: Save stdout/stderr as evidence
- [ ] **Log file collection**: Read and attach log files
- [ ] **File artifacts**: Collect generated files (configs, reports, etc.)
- [ ] **Video recording**: Record operation execution sessions
- [ ] Evidence validation (file size, format, content)
- [ ] Evidence storage and organization
- [ ] Evidence gallery in generated reports

**Priority**: HIGH
**Complexity**: High (requires OS-specific integrations)
**Estimated**: 3-4 weeks

**Technical Notes**:
- Screenshot: Use `puppeteer` for web, OS-specific tools for desktop
- Video: `ffmpeg` or platform screen recording APIs
- Storage: Local filesystem first, S3/cloud storage later

### 2.3 Interactive Execution Mode
- [ ] Step-by-step execution with user prompts
- [ ] Manual step instruction display
- [ ] Evidence upload interface (CLI file picker)
- [ ] Step completion confirmation
- [ ] Pause/resume functionality
- [ ] Skip step capability
- [ ] Rollback on failure
- [ ] Progress tracking and display

**Priority**: HIGH
**Complexity**: Medium
**Estimated**: 2 weeks

### 2.4 Session Management
- [ ] Session state persistence
- [ ] Resume interrupted operations
- [ ] Session history and logs
- [ ] Multi-session support
- [ ] Session export/import
- [ ] Checkpoint creation
- [ ] Session cleanup and archival

**Priority**: MEDIUM
**Complexity**: Low
**Estimated**: 1 week

---

## 🔮 Phase 3: Integrations & Automation (FUTURE)

**Goal**: Connect with external systems for approval, documentation, and alerting

### 3.1 Jira Integration
- [ ] Create approval tickets automatically
- [ ] Poll for approval status
- [ ] Link evidence to Jira issues
- [ ] Update ticket status on completion
- [ ] Comment with execution summary
- [ ] Custom field mapping
- [ ] Jira workflow transitions

**Priority**: MEDIUM
**Complexity**: Medium
**Estimated**: 2 weeks

### 3.2 Confluence Integration (Publishing)
- [ ] Direct publish to Confluence space
- [ ] Page creation and updates
- [ ] Attachment management
- [ ] Permission handling
- [ ] Version tracking
- [ ] Template management
- [ ] Bulk operations

**Priority**: MEDIUM
**Complexity**: Medium
**Estimated**: 1-2 weeks

### 3.3 Git Integration (Advanced)
- [ ] Git operations as steps (commit, push, tag)
- [ ] Branch management
- [ ] Pull request creation
- [ ] Merge operations
- [ ] Repository cloning
- [ ] Submodule handling

**Priority**: LOW
**Complexity**: Low
**Estimated**: 1 week

---

## 💡 Phase 4: Intelligence & Optimization (RESEARCH)

**Goal**: AI-powered assistance and operation insights

### 4.1 AI Assistant (Interactive)
- [ ] OpenAI/Anthropic integration
- [ ] Contextual help during execution
- [ ] Error diagnosis and suggestions
- [ ] Step generation from natural language
- [ ] Operation optimization recommendations
- [ ] Chat interface in CLI
- [ ] Streaming responses

**Priority**: LOW
**Complexity**: High
**Estimated**: 3-4 weeks

**Technical Notes**:
- Start with simple prompt templates
- Context window management for long operations
- Cost optimization (use cheaper models for simple queries)

### 4.2 Operation Analytics
- [ ] Execution time tracking
- [ ] Success/failure rates
- [ ] Common failure patterns
- [ ] Step duration analysis
- [ ] Environment comparison
- [ ] Trend visualization
- [ ] Performance regression detection

**Priority**: LOW
**Complexity**: Medium
**Estimated**: 2 weeks

### 4.3 Smart Scheduling
- [ ] Schedule operations with cron syntax
- [ ] Dependency-based execution
- [ ] Conditional triggers
- [ ] Resource availability checks
- [ ] Maintenance window awareness
- [ ] Auto-retry failed operations

**Priority**: LOW
**Complexity**: Medium
**Estimated**: 2 weeks

---

### Web UI
- [ ] Operation editor (visual YAML builder)
- [ ] Execution dashboard
- [ ] Evidence gallery viewer
- [ ] Real-time execution monitoring
- [ ] Historical data visualization
- [ ] Team collaboration features

**Priority**: LOW
**Complexity**: Very High
**Estimated**: 12+ weeks

---

## 🔧 Technical Debt & Improvements

### Developer Experience
- [ ] JSDoc documentation for all public APIs
- [ ] OpenAPI contract tests
- [ ] TypeScript strict mode refinements
- [ ] Better error stack traces
- [ ] Debug logging improvements

---

## 🤝 Contributing

Want to help build these features? Check out:
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [CLAUDE.md](CLAUDE.md) - Development setup and code style
- [GitHub Issues](https://github.com/eric4545/samaritan/issues) - Pick an issue

**Priority areas for contributors**:
1. Command execution engine (Phase 2.1)
2. Evidence collection (Phase 2.2)
3. Test coverage improvements
4. Documentation and examples

---
