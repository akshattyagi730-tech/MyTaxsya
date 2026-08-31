import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[React ErrorBoundary] Uncaught rendering exception:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 m-4 bg-destructive/10 border border-destructive/20 rounded-xl space-y-4 text-center">
          <div className="flex justify-center">
            <AlertCircle className="w-10 h-10 text-destructive" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-destructive">
              Something went wrong while processing the invoice.
            </h3>
            <p className="text-xs text-destructive/80 max-w-md mx-auto">
              {this.state.error?.message || "An unexpected rendering error occurred inside the invoice importer."}
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={this.handleReset}
              className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reset Importer
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
